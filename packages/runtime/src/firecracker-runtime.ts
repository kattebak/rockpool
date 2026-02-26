import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { RuntimeRepository, VmStatus } from "./types.ts";
import { createSlotAllocator } from "./slot-allocator.ts";
import { createSshCommands } from "./ssh-commands.ts";

const execFileAsync = promisify(execFile);

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_POLL_MAX_ATTEMPTS = 60;
const STOP_TIMEOUT_MS = 10000;
const BOOT_POLL_INTERVAL_MS = 500;
const BOOT_POLL_MAX_ATTEMPTS = 30;

type ExecFn = (bin: string, args: string[]) => Promise<string>;
type SpawnFn = (bin: string, args: string[], cwd?: string) => void;

function defaultExec(bin: string, args: string[]): Promise<string> {
	return execFileAsync(bin, args).then(({ stdout }) => stdout.trim());
}

function defaultSpawn(bin: string, args: string[], _cwd?: string): void {
	const child = spawn(bin, args, {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
}

export interface FirecrackerRuntimeOptions {
	basePath?: string;
	kernelPath?: string;
	baseImageDir?: string;
	vmDir?: string;
	bridgeName?: string;
	subnetPrefix?: string;
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

interface VmConfig {
	bootSource: {
		kernelImagePath: string;
		bootArgs: string;
	};
	drives: Array<{
		driveId: string;
		isRootDevice: boolean;
		isReadOnly: boolean;
		pathOnHost: string;
	}>;
	machineConfig: {
		vcpuCount: number;
		memSizeMib: number;
		smt: boolean;
	};
	networkInterfaces: Array<{
		ifaceId: string;
		guestMac: string;
		hostDevName: string;
	}>;
}

export function createFirecrackerRuntime(options: FirecrackerRuntimeOptions = {}): RuntimeRepository {
	const exec = options.exec ?? defaultExec;
	const spawnFn = options.spawn ?? defaultSpawn;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const pollMaxAttempts = options.pollMaxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;

	const projectRoot = new URL("../../..", import.meta.url).pathname;
	const basePath = options.basePath ?? resolve(projectRoot, ".firecracker");
	const kernelPath = options.kernelPath ?? join(basePath, "kernel", "vmlinux");
	const baseImageDir = options.baseImageDir ?? join(basePath, "base");
	const vmDir = options.vmDir ?? join(basePath, "vms");
	const bridgeName = options.bridgeName ?? "rockpool0";
	const subnetPrefix = options.subnetPrefix ?? "172.16";
	const vcpuCount = options.vcpuCount ?? 2;
	const memSizeMib = options.memSizeMib ?? 4096;
	const sshKeyPath = options.sshKeyPath;
	const sshUser = options.sshUser ?? "admin";
	const netScriptPath = options.netScriptPath ?? join(projectRoot, "npm-scripts", "firecracker-net.sh");

	// Ensure directories exist
	mkdirSync(vmDir, { recursive: true });

	const slotAllocator = createSlotAllocator({ basePath, subnetPrefix });
	slotAllocator.load();

	const getIpInternal = (name: string): string => {
		const allocation = slotAllocator.get(name);
		if (!allocation) {
			throw new Error(`Firecracker: no IP allocation for VM "${name}"`);
		}
		return allocation.guestIp;
	};

	let sshCommands: ReturnType<typeof createSshCommands> | undefined;
	if (sshKeyPath) {
		sshCommands = createSshCommands({
			sshKeyPath,
			sshUser,
			exec,
			pollIntervalMs,
			pollMaxAttempts,
		});
	}

	async function runNetScript(action: "create" | "destroy", tapName: string, tapIp: string): Promise<void> {
		await exec("sudo", [netScriptPath, action, tapName, `${tapIp}/30`, bridgeName]);
	}

	function writeVmConfig(name: string, allocation: ReturnType<typeof slotAllocator.get>): void {
		if (!allocation) {
			throw new Error(`Firecracker: no allocation for VM "${name}"`);
		}

		const config: VmConfig = {
			bootSource: {
				kernelImagePath: kernelPath,
				bootArgs: [
					"console=ttyS0",
					"reboot=k",
					"panic=1",
					"pci=off",
					`rockpool.ip=${allocation.guestIp}`,
					`rockpool.gw=${allocation.tapIp}`,
					`rockpool.mask=${allocation.mask}`,
				].join(" "),
			},
			drives: [
				{
					driveId: "rootfs",
					isRootDevice: true,
					isReadOnly: false,
					pathOnHost: join(vmDir, name, "rootfs.ext4"),
				},
			],
			machineConfig: {
				vcpuCount,
				memSizeMib,
				smt: false,
			},
			networkInterfaces: [
				{
					ifaceId: "eth0",
					guestMac: allocation.guestMac,
					hostDevName: allocation.tapName,
				},
			],
		};

		const configPath = join(vmDir, name, "vm.json");
		mkdirSync(dirname(configPath), { recursive: true });
		writeFileSync(configPath, JSON.stringify(config, null, 2));
	}

	async function waitForBoot(name: string): Promise<void> {
		const vmPath = join(vmDir, name);
		const socketPath = join(vmPath, "firecracker.sock");

		for (let attempt = 0; attempt < BOOT_POLL_MAX_ATTEMPTS; attempt++) {
			if (!existsSync(socketPath)) {
				await new Promise((resolve) => setTimeout(resolve, BOOT_POLL_INTERVAL_MS));
				continue;
			}

			// Socket exists, try to query the API
			try {
				await exec("curl", [
					"--unix-socket",
					socketPath,
					"-X",
					"GET",
					"http://localhost/",
				]);
				return;
			} catch {
				// API not ready yet
			}

			await new Promise((resolve) => setTimeout(resolve, BOOT_POLL_INTERVAL_MS));
		}
		throw new Error(`Firecracker: timed out waiting for VM "${name}" to boot`);
	}

	async function sendCtrlAltDel(socketPath: string): Promise<void> {
		await exec("curl", [
			"--unix-socket",
			socketPath,
			"-X",
			"PUT",
			"--data",
			'{"action_type": "SendCtrlAltDel"}',
			"http://localhost/actions",
		]);
	}

	async function isProcessRunning(pid: number): Promise<boolean> {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	async function getPid(name: string): Promise<number | null> {
		const pidPath = join(vmDir, name, "firecracker.pid");
		if (!existsSync(pidPath)) {
			return null;
		}
		const pid = Number.parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
		if (Number.isNaN(pid)) {
			return null;
		}
		return pid;
	}

	return {
		async create(name: string, image: string): Promise<void> {
			// Allocate network slot
			const allocation = slotAllocator.allocate(name);

			// Create VM directory
			const vmPath = join(vmDir, name);
			mkdirSync(vmPath, { recursive: true });

			// Copy base rootfs
			const baseImage = join(baseImageDir, `${image}.ext4`);
			if (!existsSync(baseImage)) {
				throw new Error(`Firecracker: base image not found: ${baseImage}`);
			}
			copyFileSync(baseImage, join(vmPath, "rootfs.ext4"));

			// Create TAP device
			await runNetScript("create", allocation.tapName, allocation.tapIp);

			// Write VM config
			writeVmConfig(name, allocation);
		},

		async start(name: string): Promise<void> {
			const vmPath = join(vmDir, name);
			const socketPath = join(vmPath, "firecracker.sock");
			const pidPath = join(vmPath, "firecracker.pid");
			const configPath = join(vmPath, "vm.json");

			// Clean up stale socket
			if (existsSync(socketPath)) {
				rmSync(socketPath);
			}

			// Spawn firecracker process
			spawnFn("firecracker", ["--api-sock", socketPath, "--config-file", configPath], vmPath);

			// Write PID
			// We need to find the actual PID - this is a limitation since detached processes
			// don't give us the PID easily. For now, we'll poll for the process.
			// A better approach would be to use a wrapper script that writes the PID.
			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Find firecracker process by socket
			const pid = await exec("pgrep", ["-f", `firecracker.*${socketPath}`])
				.then(({ stdout }) => Number.parseInt(stdout.trim().split("\n")[0], 10))
				.catch(() => null);

			if (pid) {
				writeFileSync(pidPath, String(pid));
			}

			// Wait for VM to boot
			await waitForBoot(name);
		},

		async stop(name: string): Promise<void> {
			const vmPath = join(vmDir, name);
			const socketPath = join(vmPath, "firecracker.sock");
			const pidPath = join(vmPath, "firecracker.pid");

			if (!existsSync(socketPath)) {
				return;
			}

			// Send CtrlAltDel for graceful shutdown
			try {
				await sendCtrlAltDel(socketPath);
			} catch {
				// Ignore errors - VM might already be stopping
			}

			// Wait for process to exit
			const startTime = Date.now();
			while (Date.now() - startTime < STOP_TIMEOUT_MS) {
				const pid = await getPid(name);
				if (!pid || !(await isProcessRunning(pid))) {
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 500));
			}

			// Force kill if still running
			const pid = await getPid(name);
			if (pid && await isProcessRunning(pid)) {
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					// Ignore
				}
			}

			// Clean up socket
			if (existsSync(socketPath)) {
				rmSync(socketPath);
			}
			if (existsSync(pidPath)) {
				rmSync(pidPath);
			}
		},

		async remove(name: string): Promise<void> {
			const vmPath = join(vmDir, name);

			// Stop if running
			try {
				await this.stop(name);
			} catch {
				// Ignore stop errors during remove
			}

			// Get allocation for cleanup
			const allocation = slotAllocator.get(name);

			// Destroy TAP device
			if (allocation) {
				try {
					await runNetScript("destroy", allocation.tapName, allocation.tapIp);
				} catch {
					// Ignore TAP cleanup errors
				}
				slotAllocator.release(name);
			}

			// Remove VM directory
			if (existsSync(vmPath)) {
				rmSync(vmPath, { recursive: true });
			}
		},

		async status(name: string): Promise<VmStatus> {
			const vmPath = join(vmDir, name);

			// Check if directory exists
			if (!existsSync(vmPath)) {
				return "not_found";
			}

			// Check if process is running
			const pid = await getPid(name);
			if (!pid) {
				return "stopped";
			}

			const running = await isProcessRunning(pid);
			return running ? "running" : "stopped";
		},

		getIp: getIpInternal,

		async configure(name: string, env: Record<string, string>): Promise<void> {
			if (!sshCommands) {
				throw new Error("Firecracker: sshKeyPath is required for configure");
			}
			await sshCommands.configure(name, getIpInternal, env);
		},

		async clone(name: string, vmIp: string, repository: string, token?: string): Promise<void> {
			if (!sshCommands) {
				throw new Error("Firecracker: sshKeyPath is required for clone");
			}
			await sshCommands.clone(name, vmIp, repository, token);
		},
	};
}
