import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import http from "node:http";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { SlotAllocator } from "./slot-allocator.ts";
import { createSlotAllocator } from "./slot-allocator.ts";
import { createSshCommands } from "./ssh-commands.ts";
import type { RuntimeRepository, VmStatus } from "./types.ts";

const execFileAsync = promisify(execFile);

const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 60;
const STOP_TIMEOUT_MS = 10000;
const DEFAULT_VCPU_COUNT = 2;
const DEFAULT_MEM_SIZE_MIB = 4096;
const DEFAULT_BRIDGE_NAME = "rockpool0";

type ExecFn = (bin: string, args: string[]) => Promise<string>;
type SpawnFn = (bin: string, args: string[]) => void;

function defaultExec(bin: string, args: string[]): Promise<string> {
	return execFileAsync(bin, args).then(({ stdout }) => stdout.trim());
}

function defaultSpawn(bin: string, args: string[]): void {
	const child = spawn(bin, args, {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
}

function httpPutUnixSocket(socketPath: string, path: string, body: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ socketPath, path, method: "PUT", headers: { "Content-Type": "application/json" } },
			(res) => {
				res.resume();
				res.on("end", () => {
					if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
						resolve();
					} else {
						reject(new Error(`Firecracker API returned ${res.statusCode}`));
					}
				});
			},
		);
		req.on("error", reject);
		req.end(body);
	});
}

interface VmConfig {
	"boot-source": {
		kernel_image_path: string;
		boot_args: string;
	};
	drives: Array<{
		drive_id: string;
		is_root_device: boolean;
		is_read_only: boolean;
		path_on_host: string;
	}>;
	"machine-config": {
		vcpu_count: number;
		mem_size_mib: number;
		smt: boolean;
	};
	"network-interfaces": Array<{
		iface_id: string;
		guest_mac: string;
		host_dev_name: string;
	}>;
	balloon?: {
		amount_mib: number;
		deflate_on_oom: boolean;
		stats_polling_interval_s: number;
	};
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readPidFile(pidPath: string): number | undefined {
	if (!existsSync(pidPath)) {
		return undefined;
	}
	const content = readFileSync(pidPath, "utf-8").trim();
	const pid = Number.parseInt(content, 10);
	if (Number.isNaN(pid)) {
		return undefined;
	}
	return pid;
}

export interface FirecrackerRuntimeOptions {
	basePath: string;
	kernelPath?: string;
	baseImageDir?: string;
	vmDir?: string;
	bridgeName?: string;
	vcpuCount?: number;
	memSizeMib?: number;
	sshKeyPath?: string;
	sshUser?: string;
	netScriptPath?: string;
	exec?: ExecFn;
	spawn?: SpawnFn;
	pollIntervalMs?: number;
	pollMaxAttempts?: number;
}

export function createFirecrackerRuntime(options: FirecrackerRuntimeOptions): RuntimeRepository {
	const basePath = resolve(options.basePath);
	const kernelPath = options.kernelPath ?? join(basePath, "kernel", "vmlinux");
	const baseImageDir = options.baseImageDir ?? join(basePath, "base");
	const vmDir = options.vmDir ?? join(basePath, "vms");
	const bridgeName = options.bridgeName ?? DEFAULT_BRIDGE_NAME;
	const vcpuCount = options.vcpuCount ?? DEFAULT_VCPU_COUNT;
	const memSizeMib = options.memSizeMib ?? DEFAULT_MEM_SIZE_MIB;
	const sshUser = options.sshUser ?? "admin";
	const netScriptPath = options.netScriptPath ?? "npm-scripts/firecracker-net.sh";
	const exec = options.exec ?? defaultExec;
	const spawnFn = options.spawn ?? defaultSpawn;
	const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
	const pollMaxAttempts = options.pollMaxAttempts ?? POLL_MAX_ATTEMPTS;

	const slotsFile = join(basePath, "slots.json");
	const slots: SlotAllocator = createSlotAllocator(slotsFile);
	slots.load();

	const sshKeyPath = options.sshKeyPath;
	const ssh = sshKeyPath
		? createSshCommands({ sshKeyPath, sshUser, exec, pollIntervalMs, pollMaxAttempts })
		: undefined;

	function requireSsh() {
		if (!ssh) {
			throw new Error("Firecracker: sshKeyPath is required for configure");
		}
		return ssh;
	}

	function vmDirPath(name: string): string {
		return join(vmDir, name);
	}

	function socketPath(name: string): string {
		return join(vmDirPath(name), "firecracker.sock");
	}

	function pidFilePath(name: string): string {
		return join(vmDirPath(name), "firecracker.pid");
	}

	function vmConfigPath(name: string): string {
		return join(vmDirPath(name), "vm.json");
	}

	function rootfsPath(name: string): string {
		return join(vmDirPath(name), "rootfs.ext4");
	}

	async function getIpForVm(name: string): Promise<string> {
		const allocation = slots.get(name);
		if (!allocation) {
			throw new Error(`Firecracker: no slot allocation for VM "${name}"`);
		}
		return allocation.guestIp;
	}

	return {
		async create(name: string, image: string): Promise<void> {
			const allocation = slots.allocate(name);
			const dir = vmDirPath(name);
			await mkdir(dir, { recursive: true });

			const baseImagePath = join(baseImageDir, `${image}.ext4`);
			await exec("cp", ["--reflink=auto", baseImagePath, rootfsPath(name)]);

			await exec("sudo", [
				netScriptPath,
				"create",
				allocation.tapName,
				`${allocation.tapIp}/${allocation.mask}`,
				bridgeName,
			]);

			const bootArgs = `console=ttyS0 reboot=k panic=1 pci=off rockpool.ip=${allocation.guestIp} rockpool.gw=${allocation.tapIp} rockpool.mask=${allocation.mask}`;

			const config: VmConfig = {
				"boot-source": {
					kernel_image_path: kernelPath,
					boot_args: bootArgs,
				},
				drives: [
					{
						drive_id: "rootfs",
						is_root_device: true,
						is_read_only: false,
						path_on_host: rootfsPath(name),
					},
				],
				"machine-config": {
					vcpu_count: vcpuCount,
					mem_size_mib: memSizeMib,
					smt: false,
				},
				"network-interfaces": [
					{
						iface_id: "eth0",
						guest_mac: allocation.guestMac,
						host_dev_name: allocation.tapName,
					},
				],
				balloon: {
					amount_mib: 0,
					deflate_on_oom: true,
					stats_polling_interval_s: 5,
				},
			};

			writeFileSync(vmConfigPath(name), JSON.stringify(config, null, 2));
		},

		async start(name: string): Promise<void> {
			const sock = socketPath(name);

			if (existsSync(sock)) {
				unlinkSync(sock);
			}

			const dir = vmDirPath(name);
			const logPath = join(dir, "firecracker.log");
			const pidPath = pidFilePath(name);

			spawnFn("sudo", [
				"bash",
				"-c",
				`echo $$ > ${pidPath} && exec firecracker --api-sock ${sock} --config-file ${vmConfigPath(name)} --log-path ${logPath} --level Warning`,
			]);

			for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
				await new Promise((r) => setTimeout(r, pollIntervalMs));

				const pid = readPidFile(pidPath);
				if (pid && processIsAlive(pid)) {
					return;
				}

				if (existsSync(sock)) {
					return;
				}
			}
			throw new Error(`Firecracker: timed out waiting for VM "${name}" to start`);
		},

		async stop(name: string): Promise<void> {
			const pidPath = pidFilePath(name);
			const pid = readPidFile(pidPath);

			if (!pid || !processIsAlive(pid)) {
				return;
			}

			const sock = socketPath(name);
			if (existsSync(sock)) {
				await httpPutUnixSocket(
					sock,
					"/actions",
					JSON.stringify({ action_type: "SendCtrlAltDel" }),
				).catch(() => {});
			}

			const deadline = Date.now() + STOP_TIMEOUT_MS;
			while (Date.now() < deadline) {
				if (!processIsAlive(pid)) {
					break;
				}
				await new Promise((r) => setTimeout(r, pollIntervalMs));
			}

			if (processIsAlive(pid)) {
				try {
					await exec("sudo", ["kill", "-KILL", String(pid)]);
				} catch {
					// process may have already exited
				}
			}

			if (existsSync(sock)) {
				unlinkSync(sock);
			}
		},

		async remove(name: string): Promise<void> {
			const pidPath = pidFilePath(name);
			const pid = readPidFile(pidPath);

			if (pid && processIsAlive(pid)) {
				await this.stop(name);
			}

			const allocation = slots.get(name);
			if (allocation) {
				await exec("sudo", [netScriptPath, "destroy", allocation.tapName, "", bridgeName]);
				slots.release(name);
			}

			const dir = vmDirPath(name);
			if (existsSync(dir)) {
				await rm(dir, { recursive: true, force: true });
			}
		},

		async status(name: string): Promise<VmStatus> {
			const dir = vmDirPath(name);
			if (!existsSync(dir)) {
				return "not_found";
			}

			const pid = readPidFile(pidFilePath(name));
			if (!pid || !processIsAlive(pid)) {
				return "stopped";
			}

			return "running";
		},

		getIp: getIpForVm,

		async clone(name: string, vmIp: string, repository: string, token?: string): Promise<void> {
			return requireSsh().clone(name, vmIp, repository, token);
		},

		async readFile(name: string, vmIp: string, filePath: string): Promise<string> {
			return requireSsh().readFile(name, vmIp, filePath);
		},

		async writeFile(name: string, vmIp: string, filePath: string, content: string): Promise<void> {
			return requireSsh().writeFile(name, vmIp, filePath, content);
		},

		async configure(name: string, env: Record<string, string>): Promise<void> {
			return requireSsh().configure(name, getIpForVm, env);
		},
	};
}
