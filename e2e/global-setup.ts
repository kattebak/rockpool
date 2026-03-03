import { execSync } from "node:child_process";

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "http://localhost:8080";
const API_URL = process.env.API_URL ?? "http://localhost:8080/api";
const CADDY_USERNAME = process.env.CADDY_USERNAME ?? "admin";
const CADDY_PASSWORD = process.env.CADDY_PASSWORD ?? "admin";

const POLL_INTERVAL = 2_000;
const AUTH_HEADER = `Basic ${Buffer.from(`${CADDY_USERNAME}:${CADDY_PASSWORD}`).toString("base64")}`;

const IS_ROOTVM = process.env.E2E_PROFILE === "rootvm";

function sshCmd(remoteCommand: string): string {
	return `npm run ssh:vm -- '${remoteCommand}'`;
}

function composeCmd(args: string): string {
	if (IS_ROOTVM) {
		const envFile = process.env.ENV_FILE ?? "test.env";
		const base = `ENV_FILE=${envFile} podman compose -f compose.yaml -f compose.test.yaml`;
		return sshCmd(`cd /mnt/rockpool && ${base} ${args}`);
	}

	return `npm-scripts/podman.sh test.env ${args}`;
}

function dumpComposeLogs(): void {
	try {
		const output = execSync(composeCmd("logs --tail=30"), {
			encoding: "utf-8",
			timeout: 15_000,
		});
		console.error("--- compose logs ---\n", output);
	} catch {}
}

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
	dumpComposeLogs();
	throw new Error(`${url} did not become ready within ${timeoutMs}ms (last status: ${lastStatus})`);
}

export default async function globalSetup(): Promise<void> {
	try {
		execSync(composeCmd("down"), { stdio: "ignore" });
	} catch {}
	execSync(composeCmd("up -d"), { stdio: "inherit" });

	await pollUntilReady(`${API_URL}/health`, 60_000);
	const authHeaders = { Authorization: AUTH_HEADER };
	await pollUntilReady(`${API_URL}/ping`, 30_000, authHeaders);
	await pollUntilReady(`${DASHBOARD_URL}/app/workspaces`, 30_000, authHeaders);
}
