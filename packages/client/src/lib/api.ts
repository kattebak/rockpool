import {
	client as sdkClient,
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
import { PortSchema, WorkspaceListResponseSchema, WorkspaceSchema } from "@rockpool/validators";
import { z } from "zod";
import type {
	AddPortRequest,
	CreateWorkspaceRequest,
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
	return WorkspaceListResponseSchema.parse(data);
}

export async function getWorkspace(id: string): Promise<Workspace> {
	const { data } = await workspacesRead({ path: { id }, throwOnError: true });
	return WorkspaceSchema.parse(data);
}

export async function createWorkspace(body: CreateWorkspaceRequest): Promise<Workspace> {
	const { data } = await workspacesCreate({ body, throwOnError: true });
	return WorkspaceSchema.parse(data);
}

export async function deleteWorkspace(id: string): Promise<void> {
	await workspacesRemove({ path: { id }, throwOnError: true });
}

export async function startWorkspace(id: string): Promise<Workspace> {
	const { data } = await workspacesStart({ path: { id }, throwOnError: true });
	return WorkspaceSchema.parse(data);
}

export async function stopWorkspace(id: string): Promise<Workspace> {
	const { data } = await workspacesStop({ path: { id }, throwOnError: true });
	return WorkspaceSchema.parse(data);
}

export async function listPorts(workspaceId: string): Promise<Port[]> {
	const { data } = await workspacesListPorts({
		path: { id: workspaceId },
		throwOnError: true,
	});
	return z.array(PortSchema).parse(data);
}

export async function addPort(workspaceId: string, body: AddPortRequest): Promise<Port> {
	const { data } = await workspacesAddPort({
		path: { id: workspaceId },
		body,
		throwOnError: true,
	});
	return PortSchema.parse(data);
}

export async function removePort(workspaceId: string, port: number): Promise<void> {
	await workspacesRemovePort({
		path: { id: workspaceId, port },
		throwOnError: true,
	});
}

export type { Workspace, Port, WorkspaceListResponse };
