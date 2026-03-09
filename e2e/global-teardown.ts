import { execSync } from "node:child_process";

const TEST_CONFIG = "rockpool.test.config.json";

export default async function globalTeardown(): Promise<void> {
	try {
		execSync(`npx rockpool stop ${TEST_CONFIG}`, { stdio: "ignore" });
	} catch {}
}
