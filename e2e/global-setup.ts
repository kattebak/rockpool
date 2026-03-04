import { execSync } from "node:child_process";
import { loadConfig } from "@rockpool/config";

const config = loadConfig();

const srv0Port = process.env.SRV0_PORT ?? "8080";
const queuePort = process.env.QUEUE_PORT ?? "9324";

const DASHBOARD_URL = `http://localhost:${srv0Port}`;
const API_URL = `http://localhost:${srv0Port}/api`;
const QUEUE_ENDPOINT = `http://localhost:${queuePort}`;

const AUTH_HEADER = config.auth.basic
	? `Basic ${Buffer.from(`${config.auth.basic.username}:${config.auth.basic.password}`).toString("base64")}`
	: "";

const POLL_INTERVAL = 2_000;

const IS_ROOTVM = process.env.E2E_PROFILE === "rootvm";

function sshCmd(remoteCommand: string): string {
	return `npm run ssh:vm -- '${remoteCommand}'`;
}

function composeCmd(args: string): string {
	if (IS_ROOTVM) {
		const base = "podman compose -f compose.yaml -f compose.test.yaml";
		return sshCmd(`cd /mnt/rockpool && ${base} ${args}`);
	}

	return `npm-scripts/podman.sh test ${args}`;
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
	try {
		execSync(composeCmd("down"), { stdio: "ignore" });
	} catch {}
	execSync(composeCmd("up -d"), { stdio: "inherit" });

	await ensureQueue();
	await pollUntilReady(`${API_URL}/health`, 60_000);
	const authHeaders = { Authorization: AUTH_HEADER };
	await pollUntilReady(`${API_URL}/ping`, 30_000, authHeaders);
	await pollUntilReady(`${DASHBOARD_URL}/app/workspaces`, 30_000, authHeaders);
}
