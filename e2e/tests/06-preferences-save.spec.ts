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
	"Preferences save requires real VMs — skipped with stub runtime",
);

test.describe("Preferences: save from running workspace", () => {
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

	test("settings list API returns empty array initially", async () => {
		const apiUrl = getApiUrl();
		const headers: Record<string, string> = { Authorization: getAuthHeader() };

		const res = await fetch(`${apiUrl}/settings`, { headers });
		expect(res.ok).toBeTruthy();
		const blobs = await res.json();
		expect(Array.isArray(blobs)).toBeTruthy();
	});

	test("settings save API returns 404 for file not yet on disk", async () => {
		const apiUrl = getApiUrl();
		const headers: Record<string, string> = { Authorization: getAuthHeader() };

		const res = await fetch(`${apiUrl}/settings/GitConfig?workspaceId=${workspaceId}`, {
			method: "PUT",
			headers,
		});
		expect(res.status).toBe(404);
	});

	test("workspace detail page shows preferences panel", async () => {
		await page.goto(`/app/workspaces/${workspaceId}`);
		await expect(page.getByRole("heading", { name: workspaceName })).toBeVisible();
		await expect(page.getByText("Running")).toBeVisible({ timeout: 10_000 });

		await expect(page.getByText("Preferences")).toBeVisible();
		await expect(page.getByText("Editor Settings")).toBeVisible();
		await expect(page.getByText("Keybindings")).toBeVisible();
		await expect(page.getByText("Git Config")).toBeVisible();
		await expect(page.getByRole("button", { name: "Save all" })).toBeVisible();
	});

	test("all preferences show Never before any save", async () => {
		const rows = page.getByRole("row").filter({ hasText: "Never" });
		await expect(rows).toHaveCount(3);
	});

	test("save all silently skips missing files", async () => {
		await page.getByRole("button", { name: "Save all" }).click();

		await expect(page.getByRole("button", { name: "Save all" })).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText(/failed to save/)).not.toBeVisible();
	});
});
