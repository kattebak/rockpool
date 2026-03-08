type ExecFn = (bin: string, args: string[]) => Promise<string>;

export interface SshCommandOptions {
	sshKeyPath: string;
	sshUser: string;
	exec: ExecFn;
	pollIntervalMs: number;
	pollMaxAttempts: number;
}

export interface SshCommands {
	sshExec(containerIp: string, cmd: string): Promise<string>;
	configure(
		name: string,
		getIp: (name: string) => Promise<string>,
		env: Record<string, string>,
	): Promise<void>;
	clone(name: string, containerIp: string, repository: string, token?: string): Promise<void>;
	readFile(name: string, containerIp: string, filePath: string): Promise<string>;
	writeFile(name: string, containerIp: string, filePath: string, content: string): Promise<void>;
}

export function createSshCommands(options: SshCommandOptions): SshCommands {
	const { sshKeyPath, sshUser, exec, pollIntervalMs, pollMaxAttempts } = options;

	function sshExec(containerIp: string, cmd: string): Promise<string> {
		return exec("ssh", [
			"-i",
			sshKeyPath,
			"-o",
			"StrictHostKeyChecking=no",
			"-o",
			"UserKnownHostsFile=/dev/null",
			"-o",
			"ConnectTimeout=5",
			`${sshUser}@${containerIp}`,
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

		const containerIp = await getIp(name);
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
			const ok = await sshExec(containerIp, cmd)
				.then(() => true)
				.catch(() => false);
			if (ok) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
		throw new Error(`SSH: timed out waiting for SSH on container "${name}" (${containerIp})`);
	}

	async function clone(
		_name: string,
		containerIp: string,
		repository: string,
		token?: string,
	): Promise<void> {
		for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
			const ready = await sshExec(containerIp, "true")
				.then(() => true)
				.catch(() => false);
			if (ready) break;
			if (attempt === pollMaxAttempts - 1) {
				throw new Error(`SSH: timed out waiting for SSH on container (${containerIp}) for clone`);
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
				containerIp,
				`mkdir -p /home/${sshUser}/.rockpool && printf '%s\\n' '${helperScript}' > /home/${sshUser}/.rockpool/git-credential-helper && chmod +x /home/${sshUser}/.rockpool/git-credential-helper`,
			);
			await sshExec(
				containerIp,
				`git config --global credential.helper '/home/${sshUser}/.rockpool/git-credential-helper'`,
			);
		}

		const repoName = repository.split("/")[1];
		await sshExec(
			containerIp,
			`git clone --depth 1 --single-branch https://github.com/${repository}.git /home/${sshUser}/${repoName}`,
		);
	}

	async function readFile(_name: string, containerIp: string, filePath: string): Promise<string> {
		return sshExec(containerIp, `cat /home/${sshUser}/${filePath}`);
	}

	async function writeFile(
		_name: string,
		containerIp: string,
		filePath: string,
		content: string,
	): Promise<void> {
		const dir = filePath.substring(0, filePath.lastIndexOf("/"));
		const escaped = content.replace(/'/g, "'\\''");
		const mkdirCmd = dir ? `mkdir -p /home/${sshUser}/${dir} && ` : "";
		await sshExec(
			containerIp,
			`${mkdirCmd}printf '%s' '${escaped}' > /home/${sshUser}/${filePath}`,
		);
	}

	return { sshExec, configure, clone, readFile, writeFile };
}
