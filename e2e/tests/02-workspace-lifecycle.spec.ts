import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { connectBrowser, createTestContext, isTestProfile } from "../helpers/platform";
import { deleteWorkspaceViaApi, provisionTimeout, uniqueWorkspaceName } from "../helpers/workspace";

test.describe("Workspace lifecycle: create → provision → stop → delete", () => {
	test.describe.configure({ mode: "serial" });

	let browser: Browser;
	let context: BrowserContext;
	let page: Page;
	const workspaceName = uniqueWorkspaceName();

	test.beforeAll(async () => {
		browser = await connectBrowser();
		context = await createTestContext(browser);
		page = await context.newPage();
	});

	test.afterAll(async () => {
		try {
			await deleteWorkspaceViaApi(workspaceName);
		} catch {
			// Best-effort cleanup
		}
		await context?.close();
		if (isTestProfile()) await browser?.close();
	});

	test("navigate to create workspace page", async () => {
		await page.goto("/app/workspaces");
		await page.getByRole("button", { name: "New workspace" }).click();
		await expect(page).toHaveURL(/\/app\/workspaces\/new/);
		await expect(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();
	});

	test("fill in workspace name and submit", async () => {
		await page.getByLabel("Name").fill(workspaceName);
		await page.getByRole("button", { name: "Create workspace" }).click();
	});

	test("navigates to workspace detail page", async () => {
		await expect(page).toHaveURL(/\/app\/workspaces\//);
		await expect(page.getByRole("heading", { name: workspaceName })).toBeVisible();
	});

	test("workspace provisions and reaches running state", async () => {
		await expect(page.getByText("Running")).toBeVisible({
			timeout: provisionTimeout(),
		});
	});

	test("Open IDE link appears when running", async () => {
		await expect(page.getByRole("link", { name: "Open IDE" })).toBeVisible();
	});

	test("stop the workspace", async () => {
		await page.getByRole("button", { name: "Stop" }).click();
		await expect(page.getByText("Stopping a workspace disconnects")).toBeVisible();
		await page.getByRole("button", { name: "Stop workspace" }).click();
		await expect(page.getByText("Stopped")).toBeVisible({
			timeout: isTestProfile() ? 10_000 : 60_000,
		});
	});

	test("delete the workspace", async () => {
		await page.getByRole("button", { name: "Delete" }).click();
		await expect(page.getByText("This will permanently delete")).toBeVisible();
		await page.getByRole("button", { name: "Delete workspace" }).click();
		await expect(page).toHaveURL(/\/app\/workspaces$/);
	});

	test("workspace no longer appears in the list", async () => {
		const table = page.getByRole("table");
		await expect(table.getByText(workspaceName)).not.toBeVisible({
			timeout: 10_000,
		});
	});
});
