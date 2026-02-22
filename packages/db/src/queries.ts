import { and, eq } from "drizzle-orm";
import type { DbClient } from "./connection.ts";
import { type NewPort, type NewWorkspace, type Port, type Workspace, type WorkspaceStatus, ports, workspaces } from "./schema.ts";

export function listWorkspaces(db: DbClient): Promise<Workspace[]> {
	return db.select().from(workspaces);
}

export function getWorkspace(db: DbClient, id: string): Promise<Workspace | undefined> {
	return db
		.select()
		.from(workspaces)
		.where(eq(workspaces.id, id))
		.then((rows) => rows[0]);
}

export function getWorkspaceByName(db: DbClient, name: string): Promise<Workspace | undefined> {
	return db
		.select()
		.from(workspaces)
		.where(eq(workspaces.name, name))
		.then((rows) => rows[0]);
}

export function createWorkspace(
	db: DbClient,
	data: Pick<NewWorkspace, "name" | "image">,
): Promise<Workspace> {
	return db
		.insert(workspaces)
		.values({
			name: data.name,
			image: data.image,
			status: "creating",
		})
		.returning()
		.then((rows) => rows[0]);
}

export function updateWorkspaceStatus(
	db: DbClient,
	id: string,
	status: WorkspaceStatus,
	fields?: { vmIp?: string | null; errorMessage?: string | null },
): Promise<Workspace | undefined> {
	return db
		.update(workspaces)
		.set({
			status,
			vmIp: fields?.vmIp,
			errorMessage: fields?.errorMessage,
			updatedAt: new Date(),
		})
		.where(eq(workspaces.id, id))
		.returning()
		.then((rows) => rows[0]);
}

export function deleteWorkspace(db: DbClient, id: string): Promise<void> {
	return db
		.delete(workspaces)
		.where(eq(workspaces.id, id))
		.then(() => {});
}

export function listPorts(db: DbClient, workspaceId: string): Promise<Port[]> {
	return db.select().from(ports).where(eq(ports.workspaceId, workspaceId));
}

export function addPort(
	db: DbClient,
	data: Pick<NewPort, "workspaceId" | "port" | "label">,
): Promise<Port> {
	return db
		.insert(ports)
		.values({
			workspaceId: data.workspaceId,
			port: data.port,
			label: data.label,
		})
		.returning()
		.then((rows) => rows[0]);
}

export function removePort(db: DbClient, workspaceId: string, port: number): Promise<void> {
	return db
		.delete(ports)
		.where(and(eq(ports.workspaceId, workspaceId), eq(ports.port, port)))
		.then(() => {});
}

export function removeAllPorts(db: DbClient, workspaceId: string): Promise<void> {
	return db
		.delete(ports)
		.where(eq(ports.workspaceId, workspaceId))
		.then(() => {});
}
