import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
	createTestContext,
	createTestPage,
	getApiUrl,
	getAuthHeader,
	launchBrowser,
} from "../helpers/platform";
import { deleteWorkspaceViaApi, pollUntilStatus, uniqueWorkspaceName } from "../helpers/workspace";

const IDE_URL = process.env.VITE_IDE_URL ?? "http://localhost:8081";

test.describe("Open IDE button points to correct URL", () => {
	test.describe.configure({ mode: "serial" });

	let browser: Browser;
	let context: BrowserContext;
	let page: Page;
	const workspaceName = uniqueWorkspaceName();
	let workspaceId: string;

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
		workspaceId = workspace.id;
		await pollUntilStatus(workspaceId, "running");
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

	test("workspace detail page: Open IDE link has correct href", async () => {
		await page.goto(`/app/workspaces/${workspaceId}`);
		await expect(page.getByRole("heading", { name: workspaceName })).toBeVisible();

		const ideLink = page.getByRole("link", { name: "Open IDE" });
		await expect(ideLink).toBeVisible();
		await expect(ideLink).toHaveAttribute("href", `${IDE_URL}/workspace/${workspaceName}/`);
	});

	test("workspace list page: Open IDE link has correct href", async () => {
		await page.goto("/app/workspaces");
		await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();

		const workspaceCard = page.locator(`a:has-text("${workspaceName}")`).locator("..");
		const ideLink = workspaceCard.locator("..").getByRole("link", { name: "Open IDE" });
		await expect(ideLink).toBeVisible();
		await expect(ideLink).toHaveAttribute("href", `${IDE_URL}/workspace/${workspaceName}/`);
	});
});
