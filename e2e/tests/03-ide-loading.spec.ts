import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
	createTestContext,
	createTestPage,
	getApiUrl,
	getAuthHeader,
	launchBrowser,
} from "../helpers/platform";
import { deleteWorkspaceViaApi, pollUntilStatus, uniqueWorkspaceName } from "../helpers/workspace";

test.skip(
	process.env.RUNTIME === "stub",
	"IDE loading requires real VMs — skipped with stub runtime",
);

const IDE_PORT = Number.parseInt(process.env.SRV1_PORT ?? "8081", 10);

function buildIdeUrl(workspaceName: string): string {
	return `http://localhost:${IDE_PORT}/workspace/${workspaceName}/`;
}

test.describe("IDE loading: code-server renders in browser", () => {
	test.describe.configure({ mode: "serial" });

	let browser: Browser;
	let context: BrowserContext;
	let page: Page;
	const workspaceName = uniqueWorkspaceName();

	test.beforeAll(async () => {
		browser = await launchBrowser();
		context = await createTestContext(browser);
		page = await createTestPage(context);

		const apiUrl = getApiUrl();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: getAuthHeader(),
		};

		const createRes = await fetch(`${apiUrl}/workspaces`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				name: workspaceName,
				image: "rockpool-workspace",
			}),
		});
		const workspace = (await createRes.json()) as { id: string };
		await pollUntilStatus(workspace.id, "running");
	});

	test.afterAll(async () => {
		try {
			await deleteWorkspaceViaApi(workspaceName);
		} catch {
			// Best-effort cleanup
		}
		await page?.close();
		await context?.close();
		await browser?.close();
	});

	test("IDE URL responds (no 502)", async () => {
		const response = await page.goto(buildIdeUrl(workspaceName), {
			waitUntil: "domcontentloaded",
		});
		expect(response?.status()).toBeLessThan(500);
	});

	test("code-server root element renders", async () => {
		await expect(page.locator(".monaco-workbench").first()).toBeVisible({ timeout: 60_000 });
	});

	test("IDE shows activity bar", async () => {
		await expect(page.locator("[id='workbench.parts.activitybar']")).toBeVisible({
			timeout: 30_000,
		});
	});

	test("IDE menu bar is present", async () => {
		await expect(page.locator("[role='menubar']")).toBeVisible({ timeout: 15_000 });
	});
});
