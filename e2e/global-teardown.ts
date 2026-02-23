import { execSync } from "node:child_process";
import { unlinkSync } from "node:fs";

export default async function globalTeardown(): Promise<void> {
	execSync("npx pm2 delete ecosystem.test.config.cjs", { stdio: "ignore" });
	try {
		unlinkSync("/tmp/rockpool-e2e.db");
	} catch {}
}
