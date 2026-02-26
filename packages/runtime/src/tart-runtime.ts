import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createSshCommands } from "./ssh-commands.ts";
import type { RuntimeRepository, VmStatus } from "./types.ts";

const execFileAsync = promisify(execFile);

const IP_POLL_INTERVAL_MS = 1000;
const IP_POLL_MAX_ATTEMPTS = 60;
const STATUS_POLL_INTERVAL_MS = 500;
const STATUS_POLL_MAX_ATTEMPTS = 30;

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

function parseTartList(output: string, name: string): VmStatus {
	const lines = output.split("\n");
	const header = lines[0];
	if (!header) {
		return "not_found";
	}

	const headerColumns = header.split(/\s+/);
	const stateIndex = headerColumns.indexOf("State");
	const nameIndex = headerColumns.indexOf("Name");
	if (stateIndex === -1 || nameIndex === -1) {
		return "not_found";
	}

	for (let i = 1; i < lines.length; i++) {
		const columns = lines[i].split(/\s+/);
		if (columns[nameIndex] === name) {
			return columns[stateIndex] === "running" ? "running" : "stopped";
		}
	}
	return "not_found";
}

export interface TartRuntimeOptions {
	exec?: ExecFn;
	spawn?: SpawnFn;
	pollIntervalMs?: number;
	pollMaxAttempts?: number;
	sshKeyPath?: string;
	sshUser?: string;
}

export function createTartRuntime(options: TartRuntimeOptions = {}): RuntimeRepository {
	const exec = options.exec ?? defaultExec;
	const spawnFn = options.spawn ?? defaultSpawn;
	const pollIntervalMs = options.pollIntervalMs ?? IP_POLL_INTERVAL_MS;
	const pollMaxAttempts = options.pollMaxAttempts ?? IP_POLL_MAX_ATTEMPTS;
	const sshKeyPath = options.sshKeyPath;
	const sshUser = options.sshUser ?? "admin";

	const ssh = sshKeyPath
		? createSshCommands({ sshKeyPath, sshUser, exec, pollIntervalMs, pollMaxAttempts })
		: undefined;

	function requireSsh() {
		if (!ssh) {
			throw new Error("Tart: sshKeyPath is required for configure");
		}
		return ssh;
	}

	function tart(args: string[]): Promise<string> {
		return exec("tart", args);
	}

	async function waitForStatus(name: string, target: VmStatus): Promise<void> {
		for (let attempt = 0; attempt < STATUS_POLL_MAX_ATTEMPTS; attempt++) {
			const output = await tart(["list"]).catch(() => "");
			if (parseTartList(output, name) === target) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
		}
		throw new Error(`Tart: timed out waiting for VM "${name}" to reach status "${target}"`);
	}

	async function getIpForVm(name: string): Promise<string> {
		for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
			const output = await tart(["ip", name]).catch(() => "");
			if (output && output !== "") {
				return output;
			}
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
		throw new Error(`Tart: timed out waiting for IP of VM "${name}"`);
	}

	return {
		async create(name: string, image: string): Promise<void> {
			await tart(["clone", image, name]);
		},

		async start(name: string): Promise<void> {
			spawnFn("tart", ["run", name, "--no-graphics"]);
			await waitForStatus(name, "running");
		},

		async stop(name: string): Promise<void> {
			await tart(["stop", name]);
		},

		async remove(name: string): Promise<void> {
			await tart(["delete", name]);
		},

		async status(name: string): Promise<VmStatus> {
			const output = await tart(["list"]);
			return parseTartList(output, name);
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
