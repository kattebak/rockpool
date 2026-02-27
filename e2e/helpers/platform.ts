import { type Browser, type BrowserContext, chromium, type Page } from "@playwright/test";

const API_BASE = process.env.API_URL ?? "http://localhost:8080/api";
const CADDY_USERNAME = process.env.CADDY_USERNAME ?? "admin";
const CADDY_PASSWORD = process.env.CADDY_PASSWORD ?? "admin";

export function isStubRuntime(): boolean {
	return process.env.RUNTIME === "stub";
}

export function getApiUrl(): string {
	return API_BASE;
}

export async function launchBrowser(): Promise<Browser> {
	return chromium.launch();
}

export async function createTestContext(browser: Browser): Promise<BrowserContext> {
	const context = await browser.newContext();
	const credentials = Buffer.from(`${CADDY_USERNAME}:${CADDY_PASSWORD}`).toString("base64");
	await context.setExtraHTTPHeaders({ Authorization: `Basic ${credentials}` });
	return context;
}

export async function createTestPage(context: BrowserContext): Promise<Page> {
	return context.newPage();
}

export function getAuthHeader(): string {
	const credentials = Buffer.from(`${CADDY_USERNAME}:${CADDY_PASSWORD}`).toString("base64");
	return `Basic ${credentials}`;
}
