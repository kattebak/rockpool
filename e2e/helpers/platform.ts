import { type Browser, type BrowserContext, chromium, type Page } from "@playwright/test";

const profile = process.env.E2E_PROFILE ?? "development";

const API_BASE =
	process.env.API_URL ??
	(profile === "ci" ? "http://localhost:9080/api" : "http://localhost:8080/api");
const CADDY_USERNAME = process.env.CADDY_USERNAME ?? (profile === "ci" ? "test" : "admin");
const CADDY_PASSWORD = process.env.CADDY_PASSWORD ?? (profile === "ci" ? "test" : "admin");

export function isCiProfile(): boolean {
	return profile === "ci";
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
	// biome-ignore lint/style/useNamingConvention: HTTP header
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
