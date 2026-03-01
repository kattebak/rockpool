import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
	createTestContext,
	createTestPage,
	isStubRuntime,
	launchBrowser,
} from "../helpers/platform";
import { deleteWorkspaceViaApi, provisionTimeout } from "../helpers/workspace";

test.skip(isStubRuntime(), "GitHub workspace tests require real VMs — skipped with stub runtime");

test.describe("GitHub workspace: repo picker -> configure -> provision", () => {
	test.describe.configure({ mode: "serial" });

	let browser: Browser;
	let context: BrowserContext;
	let page: Page;
	let workspaceName: string;

	test.beforeAll(async () => {
		browser = await launchBrowser();
		context = await createTestContext(browser);
		page = await createTestPage(context);
	});

	test.afterAll(async () => {
		if (workspaceName) {
			try {
				await deleteWorkspaceViaApi(workspaceName);
			} catch {
				// Best-effort cleanup
			}
		}
		await page?.close();
		await context?.close();
		await browser?.close();
	});

	test("navigate to create workspace page", async () => {
		await page.goto("/app/workspaces");
		await page.getByRole("button", { name: "New workspace" }).click();
		await expect(page).toHaveURL(/\/app\/workspaces\/new/);
		await expect(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();
	});

	test("select Clone from GitHub source", async () => {
		await page.getByText("Clone from GitHub").click();
		await expect(page).toHaveURL(/\/app\/workspaces\/new\/repo/);
		await expect(page.getByRole("heading", { name: "Choose a repository" })).toBeVisible();
	});

	test("search for octocat/Hello-World in combobox", async () => {
		const input = page.getByPlaceholder("Search repositories...");
		await expect(input).toBeVisible();
		await input.fill("octocat/Hello-World");

		const option = page.getByRole("option", { name: /^octocat\s+octocat\/Hello-World/i }).first();
		await expect(option).toBeVisible({ timeout: 15_000 });
		await option.click();
	});

	test("navigates to configure page with repo param", async () => {
		await expect(page).toHaveURL(/\/app\/workspaces\/new\/configure\?repo=octocat%2FHello-World/);
		await expect(page.getByRole("heading", { name: "Configure workspace" })).toBeVisible();
	});

	test("name is prefilled from repo and repo card is shown", async () => {
		const nameInput = page.getByLabel("Name");
		await expect(nameInput).toHaveValue("hello-world", { timeout: 10_000 });

		await expect(page.getByText("octocat/Hello-World")).toBeVisible();
	});

	test("create workspace", async () => {
		workspaceName = page.getByLabel("Name").inputValue
			? await page.getByLabel("Name").inputValue()
			: "hello-world";

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

	test("stop the workspace", async () => {
		await page.getByRole("button", { name: "Stop" }).click();
		await expect(page.getByText("Stopping a workspace disconnects")).toBeVisible();
		await page.getByRole("button", { name: "Stop workspace" }).click();
		await expect(page.getByText("Stopped")).toBeVisible({
			timeout: isStubRuntime() ? 10_000 : 60_000,
		});
	});

	test("delete the workspace", async () => {
		await page.getByRole("button", { name: "Delete" }).click();
		await expect(page.getByText("This will permanently delete")).toBeVisible();
		await page.getByRole("button", { name: "Delete workspace" }).click();
		await expect(page).toHaveURL(/\/app\/workspaces$/);
	});
});
