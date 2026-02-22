import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeRepository, VmStatus } from "./types.ts";

const execFileAsync = promisify(execFile);

const IP_POLL_INTERVAL_MS = 1000;
const IP_POLL_MAX_ATTEMPTS = 60;

type ExecFn = (bin: string, args: string[]) => Promise<string>;

function defaultExec(bin: string, args: string[]): Promise<string> {
	return execFileAsync(bin, args).then(({ stdout }) => stdout.trim());
}

function parseTartList(output: string, name: string): VmStatus {
	const lines = output.split("\n");
	for (const line of lines) {
		const columns = line.split(/\s+/);
		if (columns[1] === name) {
			return columns[4] === "running" ? "running" : "stopped";
		}
	}
	return "not_found";
}

export interface TartRuntimeOptions {
	exec?: ExecFn;
	pollIntervalMs?: number;
	pollMaxAttempts?: number;
}

export function createTartRuntime(options: TartRuntimeOptions = {}): RuntimeRepository {
	const exec = options.exec ?? defaultExec;
	const pollIntervalMs = options.pollIntervalMs ?? IP_POLL_INTERVAL_MS;
	const pollMaxAttempts = options.pollMaxAttempts ?? IP_POLL_MAX_ATTEMPTS;

	function tart(args: string[]): Promise<string> {
		return exec("tart", args);
	}

	return {
		async create(name: string, image: string): Promise<void> {
			await tart(["clone", image, name]);
		},

		async start(name: string): Promise<void> {
			await tart(["run", name, "--no-graphics"]);
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

		async getIp(name: string): Promise<string> {
			for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
				const output = await tart(["ip", name]).catch(() => "");
				if (output && output !== "") {
					return output;
				}
				await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
			}
			throw new Error(`Tart: timed out waiting for IP of VM "${name}"`);
		},
	};
}
