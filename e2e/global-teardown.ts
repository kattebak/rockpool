import { execSync } from "node:child_process";
import { unlinkSync } from "node:fs";

const IS_ROOTVM = process.env.E2E_PROFILE === "rootvm";
const IS_PODMAN = process.env.E2E_PROFILE === "podman";

function resolvePm2Config(): string {
	if (IS_ROOTVM) return "ecosystem.rootvm-test.config.cjs";
	if (IS_PODMAN) return "ecosystem.podman-test.config.cjs";
	return "ecosystem.test.config.cjs";
}

const PM2_CONFIG = resolvePm2Config();

function sshCmd(remoteCommand: string): string {
	return `npm run ssh:vm -- '${remoteCommand}'`;
}

function pm2Cmd(args: string): string {
	if (IS_ROOTVM) {
		return sshCmd(`cd /mnt/rockpool && npx pm2 ${args}`);
	}
	return `npx pm2 ${args}`;
}

export default async function globalTeardown(): Promise<void> {
	execSync(pm2Cmd(`delete ${PM2_CONFIG}`), { stdio: "ignore" });

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
