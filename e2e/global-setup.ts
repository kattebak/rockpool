import { execSync } from "node:child_process";

const HEALTH_URL = "http://localhost:9080/api/health";
const STARTUP_TIMEOUT = 60_000;
const POLL_INTERVAL = 1_000;

export default async function globalSetup(): Promise<void> {
	execSync("npx pm2 delete ecosystem.test.config.cjs", {
		stdio: "ignore",
	});
	execSync("npx pm2 start ecosystem.test.config.cjs", { stdio: "inherit" });

	const deadline = Date.now() + STARTUP_TIMEOUT;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(HEALTH_URL);
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL));
	}
	throw new Error(`Test stack did not become healthy within ${STARTUP_TIMEOUT}ms`);
}
