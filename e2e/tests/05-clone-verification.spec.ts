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
	"Clone verification requires real VMs — skipped with stub runtime",
);

const IDE_PORT = Number.parseInt(process.env.SRV1_PORT ?? "8081", 10);

function buildIdeUrl(workspaceName: string): string {
	return `http://localhost:${IDE_PORT}/workspace/${workspaceName}/`;
}

test.describe("Clone verification: code-server opens in cloned repository", () => {
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
				repositoryId: "octocat/Hello-World",
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

	test("file explorer shows cloned repository files", async () => {
		await expect(page.getByRole("button", { name: "Explorer Section: Hello-World" })).toBeVisible({
			timeout: 30_000,
		});
	});
});
