import { execSync } from "node:child_process";
import { unlinkSync } from "node:fs";

const IS_ROOTVM = process.env.E2E_PROFILE === "rootvm";

function sshCmd(remoteCommand: string): string {
	return `npm run ssh:vm -- '${remoteCommand}'`;
}

function composeCmd(args: string): string {
	const envFile = process.env.ENV_FILE ?? "test.env";
	const elasticmqConf = process.env.ELASTICMQ_CONF ?? "elasticmq.test.conf";
	const base = `ENV_FILE=${envFile} ELASTICMQ_CONF=${elasticmqConf} podman compose`;

	if (IS_ROOTVM) {
		return sshCmd(`cd /mnt/rockpool && ${base} -f compose.yaml ${args}`);
	}

	return `${base} ${args}`;
}

export default async function globalTeardown(): Promise<void> {
	execSync(composeCmd("down"), { stdio: "ignore" });

	if (IS_ROOTVM) {
		try {
			execSync(sshCmd("rm -f /tmp/rockpool-e2e.db"), { stdio: "ignore" });
		} catch {}
	} else {
		try {
			unlinkSync("/tmp/rockpool-e2e.db");
		} catch {}
	}
}
