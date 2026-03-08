import { execSync } from "node:child_process";
import { unlinkSync } from "node:fs";

function composeCmd(args: string): string {
	return `npm-scripts/podman.sh ${args}`;
}

export default async function globalTeardown(): Promise<void> {
	try {
		execSync(composeCmd("down"), { stdio: "ignore" });
	} catch {}

	try {
		unlinkSync("/tmp/rockpool-e2e.db");
	} catch {}
}
