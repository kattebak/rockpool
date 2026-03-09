import { execSync } from "node:child_process";
import { loadConfig } from "@rockpool/config";

const TEST_CONFIG = "rockpool.test.config.json";
const config = loadConfig(TEST_CONFIG);

const httpPort = config.ports.http;
const DASHBOARD_URL = `http://localhost:${httpPort}`;
const API_URL = `http://localhost:${httpPort}/api`;

const AUTH_HEADER = config.auth.basic
	? `Basic ${Buffer.from(`${config.auth.basic.username}:${config.auth.basic.password}`).toString("base64")}`
	: "";

const POLL_INTERVAL = 2_000;

function dumpComposeLogs(): void {
	try {
		const output = execSync(`npx rockpool logs ${TEST_CONFIG} --no-follow --tail 30`, {
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
			const res = await fetch("http://localhost:9324/?Action=CreateQueue&QueueName=workspace-jobs");
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL));
	}
	throw new Error("Failed to create workspace-jobs queue on ElasticMQ");
}

export default async function globalSetup(): Promise<void> {
	try {
		execSync(`npx rockpool stop ${TEST_CONFIG}`, { stdio: "ignore" });
	} catch {}
	execSync(`npx rockpool run ${TEST_CONFIG}`, { stdio: "inherit" });

	await ensureQueue();
	await pollUntilReady(`${API_URL}/health`, 60_000);
	const authHeaders = { Authorization: AUTH_HEADER };
	await pollUntilReady(`${API_URL}/ping`, 30_000, authHeaders);
	await pollUntilReady(`${DASHBOARD_URL}/app/workspaces`, 30_000, authHeaders);
}
