import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeRepository, VmStatus } from "./types.ts";

const execFileAsync = promisify(execFile);

const DEFAULT_CPUS = 2;
const DEFAULT_MEMORY = "4g";
const DEFAULT_IMAGE = "rockpool-workspace:latest";
const DEFAULT_USER = "admin";
const STOP_TIMEOUT_SECONDS = 10;

type ExecFn = (bin: string, args: string[]) => Promise<string>;

function defaultExec(bin: string, args: string[]): Promise<string> {
	return execFileAsync(bin, args).then(({ stdout }) => stdout.trim());
}

interface PodmanInspectState {
	Status: string;
	Running: boolean;
}

interface PodmanInspectNetworkSettings {
	IPAddress: string;
}

interface PodmanInspectResult {
	State: PodmanInspectState;
	NetworkSettings: PodmanInspectNetworkSettings;
}

function parseInspectOutput(output: string): PodmanInspectResult {
	const parsed: unknown = JSON.parse(output);
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new Error("Podman: unexpected inspect output");
	}
	return parsed[0] as PodmanInspectResult;
}

function mapContainerStateToVmStatus(state: PodmanInspectState | undefined): VmStatus {
	if (!state) {
		return "stopped";
	}
	if (state.Running) {
		return "running";
	}
	return "stopped";
}

export interface PodmanRuntimeOptions {
	exec?: ExecFn;
	cpus?: number;
	memory?: string;
	defaultImage?: string;
	user?: string;
}

export function createPodmanRuntime(options: PodmanRuntimeOptions = {}): RuntimeRepository {
	const exec = options.exec ?? defaultExec;
	const cpus = options.cpus ?? DEFAULT_CPUS;
	const memory = options.memory ?? DEFAULT_MEMORY;
	const defaultImage = options.defaultImage ?? DEFAULT_IMAGE;
	const user = options.user ?? DEFAULT_USER;

	function podman(args: string[]): Promise<string> {
		return exec("podman", args);
	}

	function podmanExec(name: string, cmd: string[]): Promise<string> {
		return podman(["exec", name, ...cmd]);
	}

	function volumeName(name: string): string {
		return `${name}-data`;
	}

	async function waitForRunning(name: string, maxAttempts = 30): Promise<void> {
		for (let i = 0; i < maxAttempts; i++) {
			const output = await podman(["inspect", name, "--format", "{{.State.Running}}"]).catch(
				() => "false",
			);
			if (output === "true") return;
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		throw new Error(`Podman: container "${name}" did not become running after restart`);
	}

	return {
		async create(name: string, image: string): Promise<void> {
			const resolvedImage = image || defaultImage;
			await podman([
				"create",
				"--name",
				name,
				"-P",
				"--userns=auto",
				`--cpus=${cpus}`,
				`--memory=${memory}`,
				"--volume",
				`${volumeName(name)}:/home/${user}`,
				resolvedImage,
			]);
		},

		async start(name: string): Promise<void> {
			await podman(["start", name]);
		},

		async stop(name: string): Promise<void> {
			await podman(["stop", "--time", String(STOP_TIMEOUT_SECONDS), name]);
		},

		async remove(name: string): Promise<void> {
			await podman(["rm", name]);
		},

		async status(name: string): Promise<VmStatus> {
			const output = await podman(["inspect", name]).catch(() => "");
			if (!output) {
				return "not_found";
			}

			const result = parseInspectOutput(output);
			return mapContainerStateToVmStatus(result.State);
		},

		async getIp(name: string): Promise<string> {
			const output = await podman(["port", name, "8080"]);
			if (!output) {
				throw new Error(`Podman: no port mapping for container "${name}"`);
			}
			const match = output.match(/:(\d+)$/);
			if (!match) {
				throw new Error(`Podman: unexpected port output for container "${name}": ${output}`);
			}
			return `127.0.0.1:${match[1]}`;
		},

		async configure(name: string, env: Record<string, string>): Promise<void> {
			const workspaceName = env.ROCKPOOL_WORKSPACE_NAME;
			if (!workspaceName) {
				return;
			}

			const folder = env.ROCKPOOL_FOLDER;

			const yamlLines = [
				"bind-addr: 0.0.0.0:8080",
				"auth: none",
				"cert: false",
				`abs-proxy-base-path: /workspace/${workspaceName}`,
			];

			const yamlContent = yamlLines.join("\n");
			const configDir = `/home/${user}/.config/code-server`;

			let writeCmd = `mkdir -p ${configDir} && printf '%s\\n' '${yamlContent}' > ${configDir}/config.yaml`;

			if (folder) {
				writeCmd += ` && printf '%s' '${folder}' > ${configDir}/workspace-folder`;
			}

			await podmanExec(name, ["sh", "-c", writeCmd]);

			await podman(["restart", "--time", "2", name]);
			await waitForRunning(name);
		},

		async clone(name: string, _vmIp: string, repository: string, token?: string): Promise<void> {
			if (token) {
				const helperScript = [
					"#!/bin/sh",
					'echo "protocol=https"',
					'echo "host=github.com"',
					'echo "username=x-access-token"',
					`echo "password=${token}"`,
				].join("\n");

				await podmanExec(name, [
					"sh",
					"-c",
					`mkdir -p /home/${user}/.rockpool && printf '%s\\n' '${helperScript}' > /home/${user}/.rockpool/git-credential-helper && chmod +x /home/${user}/.rockpool/git-credential-helper`,
				]);
				await podmanExec(name, [
					"sh",
					"-c",
					`git config --global credential.helper '/home/${user}/.rockpool/git-credential-helper'`,
				]);
			}

			const repoName = repository.split("/")[1];
			await podmanExec(name, [
				"sh",
				"-c",
				`git clone --depth 1 --single-branch https://github.com/${repository}.git /home/${user}/${repoName}`,
			]);
		},

		async readFile(name: string, _vmIp: string, filePath: string): Promise<string> {
			return podmanExec(name, ["cat", `/home/${user}/${filePath}`]);
		},

		async writeFile(name: string, _vmIp: string, filePath: string, content: string): Promise<void> {
			const dir = filePath.substring(0, filePath.lastIndexOf("/"));
			const escaped = content.replace(/'/g, "'\\''");
			const mkdirCmd = dir ? `mkdir -p /home/${user}/${dir} && ` : "";
			await podmanExec(name, [
				"sh",
				"-c",
				`${mkdirCmd}printf '%s' '${escaped}' > /home/${user}/${filePath}`,
			]);
		},
	};
}
