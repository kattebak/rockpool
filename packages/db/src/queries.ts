import { WorkspaceStatus as WS } from "@rockpool/enums";
import { and, count, desc, eq, lt, or } from "drizzle-orm";
import type { DbClient } from "./connection.ts";
import {
	type NewPort,
	type NewRepository,
	type NewWorkspace,
	type Port,
	ports,
	type Repository,
	repositories,
	type Workspace,
	type WorkspaceRepository,
	type WorkspaceStatus,
	workspaceRepositories,
	workspaces,
} from "./schema.ts";

export interface PaginationParams {
	limit: number;
	cursor?: string;
}

export interface PaginatedResult<T> {
	items: T[];
	nextCursor?: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
	return Buffer.from(`${createdAt.getTime()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
	const decoded = Buffer.from(cursor, "base64url").toString();
	const separatorIndex = decoded.indexOf("|");
	if (separatorIndex === -1) {
		throw new Error("Invalid cursor format");
	}
	const timestamp = Number(decoded.slice(0, separatorIndex));
	const id = decoded.slice(separatorIndex + 1);
	if (Number.isNaN(timestamp) || !id) {
		throw new Error("Invalid cursor format");
	}
	return { createdAt: new Date(timestamp), id };
}

export function listWorkspaces(
	db: DbClient,
	params?: PaginationParams,
): Promise<PaginatedResult<Workspace>> {
	const limit = params?.limit ?? 25;
	const fetchLimit = limit + 1;

	let query = db
		.select()
		.from(workspaces)
		.orderBy(desc(workspaces.createdAt), desc(workspaces.id))
		.limit(fetchLimit);

	if (params?.cursor) {
		const { createdAt, id } = decodeCursor(params.cursor);
		query = query.where(
			or(
				lt(workspaces.createdAt, createdAt),
				and(eq(workspaces.createdAt, createdAt), lt(workspaces.id, id)),
			),
		) as typeof query;
	}

	return query.then((rows) => {
		const hasMore = rows.length > limit;
		const items = hasMore ? rows.slice(0, limit) : rows;
		const nextCursor = hasMore
			? encodeCursor(items[items.length - 1].createdAt, items[items.length - 1].id)
			: undefined;
		return { items, nextCursor };
	});
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
	data: Pick<NewWorkspace, "name" | "image"> & {
		description?: string | null;
	},
): Promise<Workspace> {
	return db
		.insert(workspaces)
		.values({
			name: data.name,
			image: data.image,
			status: WS.creating,
			description: data.description ?? null,
		})
		.returning()
		.then((rows) => rows[0]);
}

export function getRepository(db: DbClient, id: string): Promise<Repository | undefined> {
	return db
		.select()
		.from(repositories)
		.where(eq(repositories.id, id))
		.then((rows) => rows[0]);
}

export function linkWorkspaceRepository(
	db: DbClient,
	workspaceId: string,
	repositoryId: string,
): Promise<WorkspaceRepository> {
	return db
		.insert(workspaceRepositories)
		.values({ workspaceId, repositoryId })
		.returning()
		.then((rows) => rows[0]);
}

export function getWorkspaceRepository(
	db: DbClient,
	workspaceId: string,
): Promise<(WorkspaceRepository & { repository: Repository }) | undefined> {
	return db
		.select()
		.from(workspaceRepositories)
		.innerJoin(repositories, eq(workspaceRepositories.repositoryId, repositories.id))
		.where(eq(workspaceRepositories.workspaceId, workspaceId))
		.then((rows) => {
			if (rows.length === 0) return undefined;
			const row = rows[0];
			return { ...row.workspace_repository, repository: row.repository };
		});
}

export function upsertRepository(
	db: DbClient,
	data: Omit<NewRepository, "id" | "createdAt">,
): Promise<Repository> {
	const existing = db
		.select()
		.from(repositories)
		.where(eq(repositories.full_name, data.full_name))
		.get();

	if (existing) return Promise.resolve(existing);

	return db
		.insert(repositories)
		.values(data)
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

export function countWorkspaces(db: DbClient): Promise<number> {
	return db
		.select({ value: count() })
		.from(workspaces)
		.then((rows) => rows[0].value);
}

export function countWorkspacesByStatus(db: DbClient, status: WorkspaceStatus): Promise<number> {
	return db
		.select({ value: count() })
		.from(workspaces)
		.where(eq(workspaces.status, status))
		.then((rows) => rows[0].value);
}

export function listWorkspacesByStatus(
	db: DbClient,
	status: WorkspaceStatus,
): Promise<Workspace[]> {
	return db.select().from(workspaces).where(eq(workspaces.status, status));
}
