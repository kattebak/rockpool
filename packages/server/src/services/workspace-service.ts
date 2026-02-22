import type {
	DbClient,
	PaginatedResult,
	PaginationParams,
	Workspace,
	WorkspaceStatus,
} from "@tdpl/db";
import {
	countWorkspaces,
	countWorkspacesByStatus,
	createWorkspace as dbCreateWorkspace,
	getWorkspace,
	getWorkspaceByName,
	listWorkspaces,
	updateWorkspaceStatus,
} from "@tdpl/db";
import type { QueueRepository } from "@tdpl/queue";

const MAX_WORKSPACES = 999;
const MAX_CONCURRENT_STARTS = 3;

const VALID_TRANSITIONS: Record<string, WorkspaceStatus[]> = {
	creating: ["running", "error"],
	running: ["stopping", "error"],
	stopping: ["stopped", "error"],
	stopped: ["creating"],
	error: [],
};

export interface WorkspaceServiceDeps {
	db: DbClient;
	queue: QueueRepository;
}

export function createWorkspaceService(deps: WorkspaceServiceDeps) {
	const { db, queue } = deps;

	return {
		async list(params?: PaginationParams): Promise<PaginatedResult<Workspace>> {
			return listWorkspaces(db, params);
		},

		async get(id: string): Promise<Workspace | undefined> {
			return getWorkspace(db, id);
		},

		async create(name: string, image: string): Promise<Workspace> {
			const existing = await getWorkspaceByName(db, name);
			if (existing) {
				throw new ConflictError(`Workspace "${name}" already exists`);
			}

			const total = await countWorkspaces(db);
			if (total >= MAX_WORKSPACES) {
				throw new ConflictError(
					`Maximum of ${MAX_WORKSPACES} workspaces reached`,
				);
			}

			const creating = await countWorkspacesByStatus(db, "creating");
			if (creating >= MAX_CONCURRENT_STARTS) {
				throw new ConflictError(
					`Maximum of ${MAX_CONCURRENT_STARTS} concurrent workspace starts reached. Wait for pending workspaces to finish.`,
				);
			}

			const workspace = await dbCreateWorkspace(db, { name, image });
			await queue.send({ type: "create", workspaceId: workspace.id });
			return workspace;
		},

		async start(id: string): Promise<Workspace> {
			const workspace = await requireWorkspace(db, id);
			assertTransition(workspace.status, "creating");

			const creating = await countWorkspacesByStatus(db, "creating");
			if (creating >= MAX_CONCURRENT_STARTS) {
				throw new ConflictError(
					`Maximum of ${MAX_CONCURRENT_STARTS} concurrent workspace starts reached. Wait for pending workspaces to finish.`,
				);
			}

			const updated = await updateWorkspaceStatus(db, id, "creating");
			if (!updated) {
				throw new NotFoundError(`Workspace "${id}" disappeared during update`);
			}
			await queue.send({ type: "start", workspaceId: id });
			return updated;
		},

		async stop(id: string): Promise<Workspace> {
			const workspace = await requireWorkspace(db, id);
			assertTransition(workspace.status, "stopping");
			const updated = await updateWorkspaceStatus(db, id, "stopping");
			if (!updated) {
				throw new NotFoundError(`Workspace "${id}" disappeared during update`);
			}
			await queue.send({ type: "stop", workspaceId: id });
			return updated;
		},

		async remove(id: string): Promise<void> {
			const workspace = await requireWorkspace(db, id);
			if (workspace.status === "running" || workspace.status === "creating") {
				throw new ConflictError(
					`Cannot delete workspace in "${workspace.status}" state. Stop it first.`,
				);
			}
			await queue.send({ type: "delete", workspaceId: id });
		},
	};
}

async function requireWorkspace(db: DbClient, id: string): Promise<Workspace> {
	const workspace = await getWorkspace(db, id);
	if (!workspace) {
		throw new NotFoundError(`Workspace "${id}" not found`);
	}
	return workspace;
}

function assertTransition(current: WorkspaceStatus, target: WorkspaceStatus): void {
	const allowed = VALID_TRANSITIONS[current];
	if (!allowed?.includes(target)) {
		throw new ConflictError(`Cannot transition from "${current}" to "${target}"`);
	}
}

export class NotFoundError extends Error {
	readonly statusCode = 404;
}

export class ConflictError extends Error {
	readonly statusCode = 409;
}
