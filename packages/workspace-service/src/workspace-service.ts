import type { PaginatedResult, PaginationParams, Workspace, WorkspaceStatus } from "@rockpool/db";
import {
	countWorkspaces,
	countWorkspacesByStatus,
	createWorkspace as dbCreateWorkspace,
	deleteWorkspace,
	getWorkspace,
	getWorkspaceByName,
	listWorkspaces,
	removeAllPorts,
	updateWorkspaceStatus,
} from "@rockpool/db";
import { ConflictError, NotFoundError } from "./errors.ts";
import { defaultHealthCheck } from "./health-check.ts";
import type { WorkspaceServiceDeps } from "./types.ts";

export type TeardownMode = "stop" | "delete";

const MAX_WORKSPACES = 999;
const MAX_CONCURRENT_STARTS = 3;

const VALID_TRANSITIONS: Record<string, WorkspaceStatus[]> = {
	creating: ["running", "error"],
	running: ["stopping", "error"],
	stopping: ["stopped", "error"],
	stopped: ["creating"],
	error: ["creating"],
};

export function createWorkspaceService(deps: WorkspaceServiceDeps) {
	const { db, queue, runtime, caddy, logger } = deps;
	const healthCheck = deps.healthCheck ?? defaultHealthCheck(logger);

	async function configureAndWait(workspaceName: string, vmIp: string): Promise<void> {
		if (runtime.configure) {
			await runtime.configure(workspaceName, {
				ROCKPOOL_WORKSPACE_NAME: workspaceName,
			});
		}
		await healthCheck(vmIp);
	}

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
				throw new ConflictError(`Maximum of ${MAX_WORKSPACES} workspaces reached`);
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

		async provisionAndStart(id: string): Promise<void> {
			const workspace = await getWorkspace(db, id);
			if (!workspace) {
				logger.warn({ workspaceId: id }, "Workspace not found, skipping provision");
				return;
			}

			logger.info({ workspaceId: id, name: workspace.name }, "Provisioning workspace");

			const vmStatus = await runtime.status(workspace.name);

			if (vmStatus === "not_found") {
				await runtime.create(workspace.name, workspace.image);
				await runtime.start(workspace.name);
			} else if (vmStatus === "stopped") {
				logger.info({ workspaceId: id, name: workspace.name }, "VM exists but stopped, starting");
				await runtime.start(workspace.name);
			} else {
				logger.info(
					{ workspaceId: id, name: workspace.name },
					"VM already running, resuming setup",
				);
			}

			const vmIp = await runtime.getIp(workspace.name);

			await configureAndWait(workspace.name, vmIp);
			await caddy.addWorkspaceRoute(workspace.name, vmIp);
			await updateWorkspaceStatus(db, id, "running", { vmIp, errorMessage: null });

			logger.info({ workspaceId: id, name: workspace.name, vmIp }, "Workspace running");
		},

		async teardown(id: string, mode: TeardownMode): Promise<void> {
			const workspace = await getWorkspace(db, id);
			if (!workspace) {
				logger.warn({ workspaceId: id, mode }, "Workspace not found, skipping teardown");
				return;
			}

			logger.info({ workspaceId: id, name: workspace.name, mode }, "Tearing down workspace");

			if (mode === "stop") {
				await removeAllPorts(db, id);
				await runtime.stop(workspace.name);
				await caddy.removeWorkspaceRoute(workspace.name);
				await updateWorkspaceStatus(db, id, "stopped", { vmIp: null });
				logger.info({ workspaceId: id, name: workspace.name }, "Workspace stopped");
				return;
			}

			await runtime.stop(workspace.name).catch(() => {});
			await runtime.remove(workspace.name).catch(() => {});
			await caddy.removeWorkspaceRoute(workspace.name);
			await deleteWorkspace(db, id);
			logger.info({ workspaceId: id, name: workspace.name }, "Workspace deleted");
		},

		async setError(id: string, message: string): Promise<void> {
			await updateWorkspaceStatus(db, id, "error", { errorMessage: message }).catch(() => {});
		},
	};
}

async function requireWorkspace(
	db: Parameters<typeof getWorkspace>[0],
	id: string,
): Promise<Workspace> {
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
