import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_POLL_MAX_ATTEMPTS = 60;

type ExecFn = (bin: string, args: string[]) => Promise<string>;

function defaultExec(bin: string, args: string[]): Promise<string> {
	return execFileAsync(bin, args).then(({ stdout }) => stdout.trim());
}

export interface SshCommandsOptions {
	sshKeyPath: string;
	sshUser?: string;
	exec?: ExecFn;
	pollIntervalMs?: number;
	pollMaxAttempts?: number;
}

export function createSshCommands(options: SshCommandsOptions) {
	const exec = options.exec ?? defaultExec;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const pollMaxAttempts = options.pollMaxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;
	const sshKeyPath = options.sshKeyPath;
	const sshUser = options.sshUser ?? "admin";

	async function sshExec(vmIp: string, cmd: string): Promise<string> {
		const { stdout } = await execFileAsync("ssh", [
			"-i",
			sshKeyPath,
			"-o",
			"StrictHostKeyChecking=no",
			"-o",
			"UserKnownHostsFile=/dev/null",
			"-o",
			"ConnectTimeout=5",
			`${sshUser}@${vmIp}`,
			cmd,
		]);
		return stdout.trim();
	}

	async function waitForSsh(vmIp: string): Promise<void> {
		for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
			const ready = await sshExec(vmIp, "true")
				.then(() => true)
				.catch(() => false);
			if (ready) return;
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
		throw new Error(`SSH: timed out waiting for SSH on VM (${vmIp})`);
	}

	async function configure(
		name: string,
		getIp: (name: string) => Promise<string>,
		env: Record<string, string>,
	): Promise<void> {
		const workspaceName = env.ROCKPOOL_WORKSPACE_NAME;
		if (!workspaceName) return;

		const vmIp = await getIp(name);
		const folder = env.ROCKPOOL_FOLDER;

		const yamlContent = [
			"bind-addr: 0.0.0.0:8080",
			"auth: none",
			"cert: false",
			`abs-proxy-base-path: /workspace/${workspaceName}`,
		].join("\n");

		const folderOverride = folder
			? ` && sudo mkdir -p /etc/systemd/system/code-server@admin.service.d && printf '[Service]\\nExecStart=\\nExecStart=/usr/bin/code-server --bind-addr 0.0.0.0:8080 ${folder}\\n' | sudo tee /etc/system@admin.service.dd/system/code-server/folder.conf > /dev/null && sudo systemctl daemon-reload`
			: "";

		const cmd = `printf '%s\\n' '${yamlContent}' > /home/${sshUser}/.config/code-server/config.yaml${folderOverride} && sudo systemctl restart code-server@admin`;

		await waitForSsh(vmIp);

		for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
			const ok = await sshExec(vmIp, cmd)
				.then(() => true)
				.catch(() => false);
			if (ok) return;
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
		throw new Error(`SSH: timed out configuring code-server on VM "${name}" (${vmIp})`);
	}

	async function clone(
		_name: string,
		vmIp: string,
		repository: string,
		token?: string,
	): Promise<void> {
		await waitForSsh(vmIp);

		if (token) {
			const helperScript = [
				"#!/bin/sh",
				'echo "protocol=https"',
				'echo "host=github.com"',
				'echo "username=x-access-token"',
				`echo "password=${token}"`,
			].join("\n");

			await sshExec(
				vmIp,
				`mkdir -p /home/${sshUser}/.rockpool && printf '%s\\n' '${helperScript}' > /home/${sshUser}/.rockpool/git-credential-helper && chmod +x /home/${sshUser}/.rockpool/git-credential-helper`,
			);
			await sshExec(
				vmIp,
				`git config --global credential.helper '/home/${sshUser}/.rockpool/git-credential-helper'`,
			);
		}

		const repoName = repository.split("/")[1];
		await sshExec(
			vmIp,
			`git clone --depth 1 --single-branch https://github.com/${repository}.git /home/${sshUser}/${repoName}`,
		);
	}

	return {
		sshExec,
		waitForSsh,
		configure,
		clone,
	};
}
