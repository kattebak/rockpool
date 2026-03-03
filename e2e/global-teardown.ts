import { execSync } from "node:child_process";
import { unlinkSync } from "node:fs";

const IS_ROOTVM = process.env.E2E_PROFILE === "rootvm";

function sshCmd(remoteCommand: string): string {
	return `npm run ssh:vm -- '${remoteCommand}'`;
}

function composeCmd(args: string): string {
	if (IS_ROOTVM) {
		const envFile = process.env.ENV_FILE ?? "test.env";
		const elasticmqConf = process.env.ELASTICMQ_CONF ?? "elasticmq.test.conf";
		return sshCmd(
			`cd /mnt/rockpool && ENV_FILE=${envFile} ELASTICMQ_CONF=${elasticmqConf} podman compose -f compose.yaml -f compose.test.yaml ${args}`,
		);
	}

	return `npm-scripts/podman.sh test.env ${args}`;
}

export default async function globalTeardown(): Promise<void> {
	try {
		execSync(composeCmd("down"), { stdio: "ignore" });
	} catch {}

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
