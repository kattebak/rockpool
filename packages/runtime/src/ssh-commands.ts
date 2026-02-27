type ExecFn = (bin: string, args: string[]) => Promise<string>;

export interface SshCommandOptions {
	sshKeyPath: string;
	sshUser: string;
	exec: ExecFn;
	pollIntervalMs: number;
	pollMaxAttempts: number;
}

export interface SshCommands {
	sshExec(vmIp: string, cmd: string): Promise<string>;
	configure(
		name: string,
		getIp: (name: string) => Promise<string>,
		env: Record<string, string>,
	): Promise<void>;
	clone(name: string, vmIp: string, repository: string, token?: string): Promise<void>;
	readFile(name: string, vmIp: string, filePath: string): Promise<string>;
	writeFile(name: string, vmIp: string, filePath: string, content: string): Promise<void>;
}

export function createSshCommands(options: SshCommandOptions): SshCommands {
	const { sshKeyPath, sshUser, exec, pollIntervalMs, pollMaxAttempts } = options;

	function sshExec(vmIp: string, cmd: string): Promise<string> {
		return exec("ssh", [
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
	}

	async function configure(
		name: string,
		getIp: (name: string) => Promise<string>,
		env: Record<string, string>,
	): Promise<void> {
		const workspaceName = env.ROCKPOOL_WORKSPACE_NAME;
		if (!workspaceName) {
			return;
		}

		const vmIp = await getIp(name);
		const folder = env.ROCKPOOL_FOLDER;

		const yamlContent = [
			"bind-addr: 0.0.0.0:8080",
			"auth: none",
			"cert: false",
			`abs-proxy-base-path: /workspace/${workspaceName}`,
		].join("\n");

		const folderOverride = folder
			? ` && sudo mkdir -p /etc/systemd/system/code-server@admin.service.d && printf '[Service]\\nExecStart=\\nExecStart=/usr/bin/code-server --bind-addr 0.0.0.0:8080 ${folder}\\n' | sudo tee /etc/systemd/system/code-server@admin.service.d/folder.conf > /dev/null && sudo systemctl daemon-reload`
			: "";

		const cmd = `printf '%s\\n' '${yamlContent}' > /home/${sshUser}/.config/code-server/config.yaml${folderOverride} && sudo systemctl restart code-server@admin`;

		for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
			const ok = await sshExec(vmIp, cmd)
				.then(() => true)
				.catch(() => false);
			if (ok) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
		throw new Error(`SSH: timed out waiting for SSH on VM "${name}" (${vmIp})`);
	}

	async function clone(
		_name: string,
		vmIp: string,
		repository: string,
		token?: string,
	): Promise<void> {
		for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
			const ready = await sshExec(vmIp, "true")
				.then(() => true)
				.catch(() => false);
			if (ready) break;
			if (attempt === pollMaxAttempts - 1) {
				throw new Error(`SSH: timed out waiting for SSH on VM (${vmIp}) for clone`);
			}
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}

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

	async function readFile(_name: string, vmIp: string, filePath: string): Promise<string> {
		return sshExec(vmIp, `cat /home/${sshUser}/${filePath}`);
	}

	async function writeFile(
		_name: string,
		vmIp: string,
		filePath: string,
		content: string,
	): Promise<void> {
		const dir = filePath.substring(0, filePath.lastIndexOf("/"));
		const escaped = content.replace(/'/g, "'\\''");
		const mkdirCmd = dir ? `mkdir -p /home/${sshUser}/${dir} && ` : "";
		await sshExec(vmIp, `${mkdirCmd}printf '%s' '${escaped}' > /home/${sshUser}/${filePath}`);
	}

	return { sshExec, configure, clone, readFile, writeFile };
}
