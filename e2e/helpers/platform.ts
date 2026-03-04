import { type Browser, type BrowserContext, chromium, type Page } from "@playwright/test";
import { loadConfig } from "@rockpool/config";

const config = loadConfig();

const API_BASE = config.urls.api;
const CADDY_USERNAME = config.auth.basic?.username ?? "";
const CADDY_PASSWORD = config.auth.basic?.password ?? "";

export function hasGitHubAuth(): boolean {
	return config.auth.mode === "github";
}

export function getApiUrl(): string {
	return API_BASE;
}

export function getIdeUrl(): string {
	return config.urls.ide;
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
