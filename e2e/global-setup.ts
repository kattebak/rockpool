import { execSync } from "node:child_process";

const HEALTH_URL = "http://localhost:9080/api/health";
const SPA_URL = "http://localhost:9080/app/workspaces";
const STARTUP_TIMEOUT = 60_000;
const POLL_INTERVAL = 1_000;

async function pollUntilReady(url: string, deadline: number): Promise<void> {
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL));
	}
	throw new Error(`${url} did not become ready within timeout`);
}

export default async function globalSetup(): Promise<void> {
	execSync("npx pm2 delete ecosystem.test.config.cjs", {
		stdio: "ignore",
	});
	execSync("npx pm2 start ecosystem.test.config.cjs", { stdio: "inherit" });

	const deadline = Date.now() + STARTUP_TIMEOUT;
	await pollUntilReady(HEALTH_URL, deadline);
	await pollUntilReady(SPA_URL, deadline);
}
