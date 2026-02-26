import type { UserPrefsBlob, UserPrefsFileName } from "@rockpool/sdk";
import {
	gitHubListRepos,
	gitHubSearchRepos,
	client as sdkClient,
	settingsList,
	settingsSave,
	workspacesAddPort,
	workspacesCreate,
	workspacesList,
	workspacesListPorts,
	workspacesRead,
	workspacesRemove,
	workspacesRemovePort,
	workspacesStart,
	workspacesStop,
} from "@rockpool/sdk";
import {
	GitHubRepoListResponseSchema,
	GitHubRepoSearchResponseSchema,
	PortSchema,
	UserPrefsBlobSchema,
	WorkspaceListResponseSchema,
	WorkspaceSchema,
} from "@rockpool/validators";
import { z } from "zod";
import type {
	AddPortRequest,
	CreateWorkspaceRequest,
	GitHubRepo,
	GitHubRepoListResponse,
	GitHubRepoSearchResponse,
	Port,
	Workspace,
	WorkspaceListResponse,
} from "./api-types";

sdkClient.setConfig({ baseUrl: "" });

export interface ListWorkspacesParams {
	limit?: number;
	cursor?: string;
}

export async function listWorkspaces(
	params?: ListWorkspacesParams,
): Promise<WorkspaceListResponse> {
	const { data } = await workspacesList({ query: params, throwOnError: true });
	return WorkspaceListResponseSchema.parse(data) as WorkspaceListResponse;
}

export async function getWorkspace(id: string): Promise<Workspace> {
	const { data } = await workspacesRead({ path: { id }, throwOnError: true });
	return WorkspaceSchema.parse(data) as Workspace;
}

export async function createWorkspace(body: CreateWorkspaceRequest): Promise<Workspace> {
	const { data } = await workspacesCreate({ body, throwOnError: true });
	return WorkspaceSchema.parse(data) as Workspace;
}

export async function deleteWorkspace(id: string): Promise<void> {
	await workspacesRemove({ path: { id }, throwOnError: true });
}

export async function startWorkspace(id: string): Promise<Workspace> {
	const { data } = await workspacesStart({ path: { id }, throwOnError: true });
	return WorkspaceSchema.parse(data) as Workspace;
}

export async function stopWorkspace(id: string): Promise<Workspace> {
	const { data } = await workspacesStop({ path: { id }, throwOnError: true });
	return WorkspaceSchema.parse(data) as Workspace;
}

export async function listPorts(workspaceId: string): Promise<Port[]> {
	const { data } = await workspacesListPorts({
		path: { id: workspaceId },
		throwOnError: true,
	});
	return z.array(PortSchema).parse(data) as Port[];
}

export async function addPort(workspaceId: string, body: AddPortRequest): Promise<Port> {
	const { data } = await workspacesAddPort({
		path: { id: workspaceId },
		body,
		throwOnError: true,
	});
	return PortSchema.parse(data) as Port;
}

export async function removePort(workspaceId: string, port: number): Promise<void> {
	await workspacesRemovePort({
		path: { id: workspaceId, port },
		throwOnError: true,
	});
}

export interface CurrentUser {
	id: number;
	username: string;
}

export async function getCurrentUser(): Promise<CurrentUser> {
	const res = await fetch("/api/auth/me", { credentials: "same-origin" });

	if (!res.ok) {
		throw Object.assign(new Error("Not authenticated"), { status: res.status });
	}

	const body: unknown = await res.json();
	const obj = body as Record<string, unknown>;
	const user = obj.user as Record<string, unknown>;

	if (typeof user?.id !== "number" || typeof user?.username !== "string") {
		throw new Error("Unexpected /api/auth/me response");
	}

	return { id: user.id, username: user.username };
}

export async function logout(): Promise<void> {
	const res = await fetch("/api/auth/logout", {
		method: "POST",
		credentials: "same-origin",
	});

	if (!res.ok) {
		throw new Error("Logout failed");
	}
}

export async function listGitHubRepos(params?: {
	page?: number;
	per_page?: number;
	sort?: "created" | "updated" | "pushed" | "full_name";
}): Promise<GitHubRepoListResponse> {
	const { data } = await gitHubListRepos({ query: params, throwOnError: true });
	return GitHubRepoListResponseSchema.parse(data) as GitHubRepoListResponse;
}

export async function searchGitHubRepos(params: {
	q: string;
	page?: number;
	per_page?: number;
}): Promise<GitHubRepoSearchResponse> {
	const { data } = await gitHubSearchRepos({ query: params, throwOnError: true });
	return GitHubRepoSearchResponseSchema.parse(data) as GitHubRepoSearchResponse;
}

export async function listSettings(): Promise<UserPrefsBlob[]> {
	const { data } = await settingsList({ throwOnError: true });
	return z.array(UserPrefsBlobSchema).parse(data) as UserPrefsBlob[];
}

export async function saveSettings(
	name: UserPrefsFileName,
	workspaceId: string,
): Promise<UserPrefsBlob> {
	const { data } = await settingsSave({
		path: { name },
		query: { workspaceId },
		throwOnError: true,
	});
	return UserPrefsBlobSchema.parse(data) as UserPrefsBlob;
}

export type {
	GitHubRepo,
	GitHubRepoListResponse,
	GitHubRepoSearchResponse,
	Port,
	UserPrefsBlob,
	UserPrefsFileName,
	Workspace,
	WorkspaceListResponse,
};
