import type {
	AddPortRequest,
	CreateWorkspaceRequest,
	PaginatedResponse,
	Port,
	Workspace,
} from "./api-types";

class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const response = await fetch(path, {
		...options,
		headers: {
			"content-type": "application/json",
			...options?.headers,
		},
	});

	if (!response.ok) {
		const text = await response.text().catch(() => response.statusText);
		throw new ApiError(response.status, text);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return response.json() as Promise<T>;
}

export interface ListWorkspacesParams {
	limit?: number;
	cursor?: string;
}

export function listWorkspaces(
	params?: ListWorkspacesParams,
): Promise<PaginatedResponse<Workspace>> {
	const searchParams = new URLSearchParams();
	if (params?.limit) searchParams.set("limit", String(params.limit));
	if (params?.cursor) searchParams.set("cursor", params.cursor);
	const query = searchParams.toString();
	return request<PaginatedResponse<Workspace>>(`/api/workspaces${query ? `?${query}` : ""}`);
}

export function getWorkspace(id: string): Promise<Workspace> {
	return request<Workspace>(`/api/workspaces/${encodeURIComponent(id)}`);
}

export function createWorkspace(data: CreateWorkspaceRequest): Promise<Workspace> {
	return request<Workspace>("/api/workspaces", {
		method: "POST",
		body: JSON.stringify(data),
	});
}

export function deleteWorkspace(id: string): Promise<void> {
	return request<void>(`/api/workspaces/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}

export function startWorkspace(id: string): Promise<Workspace> {
	return request<Workspace>(`/api/workspaces/${encodeURIComponent(id)}/start`, {
		method: "POST",
	});
}

export function stopWorkspace(id: string): Promise<Workspace> {
	return request<Workspace>(`/api/workspaces/${encodeURIComponent(id)}/stop`, {
		method: "POST",
	});
}

export function listPorts(workspaceId: string): Promise<Port[]> {
	return request<Port[]>(`/api/workspaces/${encodeURIComponent(workspaceId)}/ports`);
}

export function addPort(workspaceId: string, data: AddPortRequest): Promise<Port> {
	return request<Port>(`/api/workspaces/${encodeURIComponent(workspaceId)}/ports`, {
		method: "POST",
		body: JSON.stringify(data),
	});
}

export function removePort(workspaceId: string, port: number): Promise<void> {
	return request<void>(`/api/workspaces/${encodeURIComponent(workspaceId)}/ports/${port}`, {
		method: "DELETE",
	});
}

export { ApiError };
