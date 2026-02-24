import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { connectBrowser, createTestContext, isTestProfile } from "../helpers/platform";

test.describe("Smoke: dashboard loads", () => {
	test.describe.configure({ mode: "serial" });

	let browser: Browser;
	let context: BrowserContext;
	let page: Page;

	test.beforeAll(async () => {
		browser = await connectBrowser();
		context = await createTestContext(browser);
		page = await context.newPage();
	});

	test.afterAll(async () => {
		await context?.close();
		if (isTestProfile()) await browser?.close();
	});

	test("can reach the dashboard through Caddy", async () => {
		await page.goto("/app/workspaces");
		await expect(page).toHaveURL(/\/app\/workspaces/);
	});

	test("dashboard renders the workspace list", async () => {
		const heading = page.getByRole("heading", { name: "Workspaces" });
		const emptyState = page.getByText("No workspaces yet");
		await expect(heading.or(emptyState)).toBeVisible();
	});

	test("header navigation is visible", async () => {
		await expect(page.getByRole("link", { name: "Rockpool" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Workspaces" })).toBeVisible();
		await expect(page.getByRole("button", { name: "New workspace" })).toBeVisible();
	});

	test("health check bypasses auth", async () => {
		const response = await page.request.fetch("/api/health", {
			headers: {},
		});
		expect(response.ok()).toBeTruthy();
		expect(await response.text()).toBe("OK");
	});

	test("server ping is reachable through Caddy", async () => {
		const response = await page.request.get("/api/ping");
		expect(response.ok()).toBeTruthy();
		expect(await response.json()).toEqual({ status: "ok" });
	});

	test("API is reachable through Caddy", async () => {
		const response = await page.request.get("/api/workspaces?limit=1");
		expect(response.ok()).toBeTruthy();
	});
});
