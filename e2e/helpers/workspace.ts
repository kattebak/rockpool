import { getApiUrl, getAuthHeader } from "./platform";

const POLL_INTERVAL = 1000;

export function uniqueWorkspaceName(): string {
	return `e2e-${Date.now()}`;
}

export function provisionTimeout(): number {
	const profile = process.env.E2E_PROFILE ?? "development";
	return profile === "test" ? 15_000 : 3 * 60 * 1000;
}

export async function deleteWorkspaceViaApi(name: string): Promise<void> {
	const apiUrl = getApiUrl();
	const headers: Record<string, string> = {
		Authorization: getAuthHeader(),
	};

	const listRes = await fetch(`${apiUrl}/workspaces?limit=100`, { headers });
	const { items } = await listRes.json();
	const workspace = items.find((w: { name: string }) => w.name === name);
	if (!workspace) return;

	if (workspace.status === "running") {
		await fetch(`${apiUrl}/workspaces/${workspace.id}/stop`, {
			method: "POST",
			headers,
		});
		await pollUntilStatus(workspace.id, "stopped");
	}

	if (workspace.status !== "creating" && workspace.status !== "stopping") {
		await fetch(`${apiUrl}/workspaces/${workspace.id}`, {
			method: "DELETE",
			headers,
		});
	}
}

export async function pollUntilStatus(
	id: string,
	status: string,
	timeout = provisionTimeout(),
): Promise<void> {
	const apiUrl = getApiUrl();
	const headers: Record<string, string> = {
		Authorization: getAuthHeader(),
	};

	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const res = await fetch(`${apiUrl}/workspaces/${id}`, { headers });
		const workspace = await res.json();
		if (workspace.status === status) return;
		if (workspace.status === "error") {
			throw new Error(`Workspace entered error state: ${workspace.errorMessage}`);
		}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL));
	}
	throw new Error(`Workspace did not reach "${status}" within ${timeout}ms`);
}
