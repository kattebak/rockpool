import { type Browser, type BrowserContext, chromium } from "@playwright/test";

const profile = process.env.E2E_PROFILE ?? "development";
const isTest = profile === "test";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const API_BASE =
	process.env.API_URL ?? (isTest ? "http://localhost:9080/api" : "http://localhost:8080/api");
const CADDY_USERNAME = process.env.CADDY_USERNAME ?? (isTest ? "test" : "admin");
const CADDY_PASSWORD = process.env.CADDY_PASSWORD ?? (isTest ? "test" : "admin");

export function getProfile(): string {
	return profile;
}

export function isTestProfile(): boolean {
	return isTest;
}

export function getApiUrl(): string {
	return API_BASE;
}

export async function connectBrowser(): Promise<Browser> {
	if (isTest) {
		return chromium.launch();
	}
	try {
		return await chromium.connectOverCDP(CDP_URL, { timeout: 5_000 });
	} catch {
		const { execSync } = await import("node:child_process");
		execSync("npm run chrome:debug &", { stdio: "ignore" });
		await new Promise((r) => setTimeout(r, 3_000));
		return chromium.connectOverCDP(CDP_URL, { timeout: 10_000 });
	}
}

export async function createTestContext(browser: Browser): Promise<BrowserContext> {
	const context = await browser.newContext();
	const credentials = Buffer.from(`${CADDY_USERNAME}:${CADDY_PASSWORD}`).toString("base64");
	await context.setExtraHTTPHeaders({
		Authorization: `Basic ${credentials}`,
	});
	return context;
}

export function getAuthHeader(): string {
	const credentials = Buffer.from(`${CADDY_USERNAME}:${CADDY_PASSWORD}`).toString("base64");
	return `Basic ${credentials}`;
}
