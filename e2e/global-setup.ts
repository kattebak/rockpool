import { execSync } from "node:child_process";

const HEALTH_URL = "http://localhost:9080/api/health";
const SPA_URL = "http://localhost:9080/app/workspaces";
const POLL_INTERVAL = 2_000;
const AUTH_HEADER = `Basic ${Buffer.from("test:test").toString("base64")}`;

async function pollUntilReady(
	url: string,
	timeoutMs: number,
	headers?: Record<string, string>,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastStatus = 0;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url, { headers });
			lastStatus = res.status;
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL));
	}
	throw new Error(
		`${url} did not become ready within ${timeoutMs}ms (last status: ${lastStatus})`,
	);
}

export default async function globalSetup(): Promise<void> {
	execSync("npx pm2 delete ecosystem.test.config.cjs", {
		stdio: "ignore",
	});
	execSync("npx pm2 start ecosystem.test.config.cjs", { stdio: "inherit" });

	await pollUntilReady(HEALTH_URL, 60_000);
	// biome-ignore lint/style/useNamingConvention: HTTP header
	const authHeaders = { Authorization: AUTH_HEADER };
	await pollUntilReady(SPA_URL, 90_000, authHeaders);
}
