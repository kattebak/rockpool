import { execSync } from "node:child_process";

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "http://localhost:8080";
const API_URL = process.env.API_URL ?? "http://localhost:8080/api";
const QUEUE_ENDPOINT = process.env.QUEUE_ENDPOINT ?? "http://localhost:9324";
const CADDY_USERNAME = process.env.CADDY_USERNAME ?? "admin";
const CADDY_PASSWORD = process.env.CADDY_PASSWORD ?? "admin";

const POLL_INTERVAL = 2_000;
const AUTH_HEADER = `Basic ${Buffer.from(`${CADDY_USERNAME}:${CADDY_PASSWORD}`).toString("base64")}`;

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

function dumpPm2Logs(): void {
	try {
		const output = execSync(pm2Cmd("logs --nostream --lines 30"), {
			encoding: "utf-8",
			timeout: 15_000,
		});
		console.error("--- PM2 logs ---\n", output);
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
	dumpPm2Logs();
	throw new Error(`${url} did not become ready within ${timeoutMs}ms (last status: ${lastStatus})`);
}

async function ensureQueue(): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${QUEUE_ENDPOINT}/?Action=CreateQueue&QueueName=workspace-jobs`);
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL));
	}
	throw new Error("Failed to create workspace-jobs queue on ElasticMQ");
}

export default async function globalSetup(): Promise<void> {
	execSync(pm2Cmd(`delete ${PM2_CONFIG}`), {
		stdio: "ignore",
	});
	execSync(pm2Cmd(`start ${PM2_CONFIG}`), { stdio: "inherit" });

	await ensureQueue();
	await pollUntilReady(`${API_URL}/health`, 60_000);
	const authHeaders = { Authorization: AUTH_HEADER };
	await pollUntilReady(`${API_URL}/ping`, 30_000, authHeaders);
	await pollUntilReady(`${DASHBOARD_URL}/app/workspaces`, 30_000, authHeaders);
}
