import type {
	PaginatedResult,
	PaginationParams,
	UserPrefsFileName,
	Workspace,
	WorkspaceStatus,
} from "@rockpool/db";
import {
	conditionalUpsertPrefsBlob,
	countWorkspaces,
	countWorkspacesByStatus,
	createWorkspace as dbCreateWorkspace,
	deleteWorkspace,
	getAllUserPrefsBlobs,
	getWorkspace,
	getWorkspaceByName,
	listWorkspaces,
	removeAllPorts,
	updateWorkspaceStatus,
} from "@rockpool/db";
import { WorkspaceStatus as WS } from "@rockpool/enums";
import { PREFS_FILE_PATHS } from "@rockpool/runtime";
import { ConflictError, NotFoundError } from "./errors.ts";
import { defaultHealthCheck } from "./health-check.ts";
import type { WorkspaceServiceDeps } from "./types.ts";

export type TeardownMode = "stop" | "delete";

const MAX_WORKSPACES = 999;
const MAX_CONCURRENT_STARTS = 3;

const VALID_TRANSITIONS: Record<string, WorkspaceStatus[]> = {
	[WS.creating]: [WS.running, WS.error],
	[WS.running]: [WS.stopping, WS.error],
	[WS.stopping]: [WS.stopped, WS.error],
	[WS.stopped]: [WS.creating],
	[WS.error]: [WS.creating],
};

function containerName(workspace: Workspace): string {
	return `${workspace.name}-${workspace.id}`;
}

export function createWorkspaceService(deps: WorkspaceServiceDeps) {
	const { db, queue, runtime, caddy, logger } = deps;
	const healthCheck = deps.healthCheck ?? defaultHealthCheck(logger);

	async function configureWorkspace(workspace: Workspace, folder?: string): Promise<void> {
		if (runtime.configure) {
			const env: Record<string, string> = {
				ROCKPOOL_WORKSPACE_NAME: workspace.name,
			};
			if (folder) {
				env.ROCKPOOL_FOLDER = folder;
			}
			await runtime.configure(containerName(workspace), env);
		}
	}

	return {
		async list(params?: PaginationParams): Promise<PaginatedResult<Workspace>> {
			return listWorkspaces(db, params);
		},

		async get(id: string): Promise<Workspace | undefined> {
			return getWorkspace(db, id);
		},

		async create(
			name: string,
			image: string,
			opts?: {
				description?: string;
				repository?: string;
				githubAccessToken?: string;
			},
		): Promise<Workspace> {
			const existing = await getWorkspaceByName(db, name);
			if (existing) {
				throw new ConflictError(`Workspace "${name}" already exists`);
			}

			const total = await countWorkspaces(db);
			if (total >= MAX_WORKSPACES) {
				throw new ConflictError(`Maximum of ${MAX_WORKSPACES} workspaces reached`);
			}

			const creating = await countWorkspacesByStatus(db, WS.creating);
			if (creating >= MAX_CONCURRENT_STARTS) {
				throw new ConflictError(
					`Maximum of ${MAX_CONCURRENT_STARTS} concurrent workspace starts reached. Wait for pending workspaces to finish.`,
				);
			}

			const workspace = await dbCreateWorkspace(db, {
				name,
				image,
				description: opts?.description,
			});
			await queue.send({
				type: "create",
				workspaceId: workspace.id,
				repository: opts?.repository,
				githubAccessToken: opts?.githubAccessToken,
			});
			return workspace;
		},

		async start(id: string): Promise<Workspace> {
			const workspace = await requireWorkspace(db, id);
			assertTransition(workspace.status, WS.creating);

			const creating = await countWorkspacesByStatus(db, WS.creating);
			if (creating >= MAX_CONCURRENT_STARTS) {
				throw new ConflictError(
					`Maximum of ${MAX_CONCURRENT_STARTS} concurrent workspace starts reached. Wait for pending workspaces to finish.`,
				);
			}

			const updated = await updateWorkspaceStatus(db, id, WS.creating);
			if (!updated) {
				throw new NotFoundError(`Workspace "${id}" disappeared during update`);
			}
			await queue.send({ type: "start", workspaceId: id });
			return updated;
		},

		async stop(id: string): Promise<Workspace> {
			const workspace = await requireWorkspace(db, id);
			assertTransition(workspace.status, WS.stopping);
			const updated = await updateWorkspaceStatus(db, id, WS.stopping);
			if (!updated) {
				throw new NotFoundError(`Workspace "${id}" disappeared during update`);
			}
			await queue.send({ type: "stop", workspaceId: id });
			return updated;
		},

		async remove(id: string): Promise<void> {
			const workspace = await requireWorkspace(db, id);
			if (workspace.status === WS.running || workspace.status === WS.creating) {
				throw new ConflictError(
					`Cannot delete workspace in "${workspace.status}" state. Stop it first.`,
				);
			}
			await queue.send({ type: "delete", workspaceId: id });
		},

		async provisionAndStart(
			id: string,
			opts?: { repository?: string; githubAccessToken?: string },
		): Promise<void> {
			const workspace = await getWorkspace(db, id);
			if (!workspace) {
				logger.warn({ workspaceId: id }, "Workspace not found, skipping provision");
				return;
			}

			const cname = containerName(workspace);
			logger.info(
				{ workspaceId: id, name: workspace.name, containerName: cname },
				"Provisioning workspace",
			);

			const containerStatus = await runtime.status(cname);

			if (containerStatus === "not_found") {
				await runtime.create(cname, workspace.image);
				await runtime.start(cname);
			} else if (containerStatus === "stopped") {
				logger.info(
					{ workspaceId: id, name: workspace.name },
					"Container exists but stopped, starting",
				);
				await runtime.start(cname);
			} else {
				logger.info(
					{ workspaceId: id, name: workspace.name },
					"Container already running, resuming setup",
				);
			}

			const repository = opts?.repository;
			const repoName = repository?.split("/")[1];
			const folder = repoName ? `/home/admin/${repoName}` : undefined;

			await configureWorkspace(workspace, folder);

			if (repository && runtime.clone) {
				await runtime.clone(cname, "", repository, opts?.githubAccessToken);
			}

			const containerIp = await runtime.getIp(cname);
			await healthCheck(containerIp);

			if (runtime.writeFile) {
				const blobs = await getAllUserPrefsBlobs(db);
				await Promise.all(
					blobs.map((blob) =>
						runtime
							.writeFile?.(cname, containerIp, PREFS_FILE_PATHS[blob.name], blob.blob)
							?.catch((err) => {
								logger.warn(
									{ workspaceId: id, prefsFile: blob.name, error: err },
									"Failed to push preference file, continuing",
								);
							}),
					),
				);
			}

			await caddy.addWorkspaceRoute(workspace.name, containerIp);
			await updateWorkspaceStatus(db, id, WS.running, { containerIp, errorMessage: null });

			logger.info({ workspaceId: id, name: workspace.name, containerIp }, "Workspace running");
		},

		async teardown(id: string, mode: TeardownMode): Promise<void> {
			const workspace = await getWorkspace(db, id);
			if (!workspace) {
				logger.warn({ workspaceId: id, mode }, "Workspace not found, skipping teardown");
				return;
			}

			const cname = containerName(workspace);
			logger.info({ workspaceId: id, name: workspace.name, mode }, "Tearing down workspace");

			if (mode === "stop") {
				if (workspace.autoSyncPrefs && workspace.containerIp && runtime.readFile) {
					for (const [name, filePath] of Object.entries(PREFS_FILE_PATHS)) {
						const content = await runtime
							.readFile(cname, workspace.containerIp, filePath)
							.catch(() => null);
						if (content === null) continue;

						await conditionalUpsertPrefsBlob(db, {
							name: name as UserPrefsFileName,
							blob: content,
						}).catch((err) => {
							logger.warn(
								{ workspaceId: id, prefsFile: name, error: err },
								"Failed to auto-sync preference file, continuing",
							);
						});
					}
				}

				await removeAllPorts(db, id);
				await runtime.stop(cname);
				await caddy.removeWorkspaceRoute(workspace.name);
				await updateWorkspaceStatus(db, id, WS.stopped, { containerIp: null });
				logger.info({ workspaceId: id, name: workspace.name }, "Workspace stopped");
				return;
			}

			await runtime.stop(cname).catch(() => {});
			await runtime.remove(cname).catch(() => {});
			await caddy.removeWorkspaceRoute(workspace.name);
			await deleteWorkspace(db, id);
			logger.info({ workspaceId: id, name: workspace.name }, "Workspace deleted");
		},

		async setError(id: string, message: string): Promise<void> {
			await updateWorkspaceStatus(db, id, WS.error, { errorMessage: message }).catch(() => {});
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
