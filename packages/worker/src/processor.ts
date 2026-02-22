import type { CaddyRepository } from "@tdpl/caddy";
import type { DbClient } from "@tdpl/db";
import {
	deleteWorkspace,
	getWorkspace,
	listPorts,
	removeAllPorts,
	updateWorkspaceStatus,
} from "@tdpl/db";
import type { WorkspaceJob } from "@tdpl/queue";
import type { RuntimeRepository } from "@tdpl/runtime";
import type { Logger } from "pino";

const HEALTH_POLL_INTERVAL_MS = 1000;
const HEALTH_POLL_MAX_ATTEMPTS = 60;

type HealthCheckFn = (vmIp: string) => Promise<void>;

export interface ProcessorDeps {
	db: DbClient;
	runtime: RuntimeRepository;
	caddy: CaddyRepository;
	logger: Logger;
	healthCheck?: HealthCheckFn;
}

function defaultHealthCheck(logger: Logger): HealthCheckFn {
	return async (vmIp: string): Promise<void> => {
		const url = `http://${vmIp}:8080/healthz`;
		for (let attempt = 0; attempt < HEALTH_POLL_MAX_ATTEMPTS; attempt++) {
			const ok = await fetch(url)
				.then((res) => res.ok)
				.catch(() => false);
			if (ok) {
				return;
			}
			logger.debug({ vmIp, attempt }, "Waiting for code-server");
			await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
		}
		throw new Error(`Timed out waiting for code-server at ${url}`);
	};
}

export function createProcessor(deps: ProcessorDeps) {
	const { db, runtime, caddy, logger } = deps;
	const healthCheck = deps.healthCheck ?? defaultHealthCheck(logger);

	async function configureAndWait(workspaceName: string, vmIp: string): Promise<void> {
		if (runtime.configure) {
			await runtime.configure(workspaceName, {
				TIDEPOOL_WORKSPACE_NAME: workspaceName,
			});
		}
		await healthCheck(vmIp);
	}

	async function handleCreate(workspaceId: string): Promise<void> {
		const workspace = await getWorkspace(db, workspaceId);
		if (!workspace) {
			logger.warn({ workspaceId }, "Workspace not found, skipping create job");
			return;
		}

		logger.info({ workspaceId, name: workspace.name }, "Creating workspace VM");

		await runtime.create(workspace.name, workspace.image);
		await runtime.start(workspace.name);
		const vmIp = await runtime.getIp(workspace.name);

		await configureAndWait(workspace.name, vmIp);
		await caddy.addWorkspaceRoute(workspace.name, vmIp);
		await updateWorkspaceStatus(db, workspaceId, "running", { vmIp });

		logger.info({ workspaceId, name: workspace.name, vmIp }, "Workspace running");
	}

	async function handleStart(workspaceId: string): Promise<void> {
		const workspace = await getWorkspace(db, workspaceId);
		if (!workspace) {
			logger.warn({ workspaceId }, "Workspace not found, skipping start job");
			return;
		}

		logger.info({ workspaceId, name: workspace.name }, "Starting workspace VM");

		await runtime.start(workspace.name);
		const vmIp = await runtime.getIp(workspace.name);

		await configureAndWait(workspace.name, vmIp);
		await caddy.addWorkspaceRoute(workspace.name, vmIp);
		await updateWorkspaceStatus(db, workspaceId, "running", { vmIp });

		logger.info({ workspaceId, name: workspace.name, vmIp }, "Workspace started");
	}

	async function removePortRoutes(workspaceId: string, workspaceName: string): Promise<void> {
		const registeredPorts = await listPorts(db, workspaceId);
		for (const p of registeredPorts) {
			await caddy.removePortRoute(workspaceName, p.port);
		}
	}

	async function handleStop(workspaceId: string): Promise<void> {
		const workspace = await getWorkspace(db, workspaceId);
		if (!workspace) {
			logger.warn({ workspaceId }, "Workspace not found, skipping stop job");
			return;
		}

		logger.info({ workspaceId, name: workspace.name }, "Stopping workspace VM");

		await removePortRoutes(workspaceId, workspace.name);
		await removeAllPorts(db, workspaceId);
		await runtime.stop(workspace.name);
		await caddy.removeWorkspaceRoute(workspace.name);
		await updateWorkspaceStatus(db, workspaceId, "stopped", { vmIp: null });

		logger.info({ workspaceId, name: workspace.name }, "Workspace stopped");
	}

	async function handleDelete(workspaceId: string): Promise<void> {
		const workspace = await getWorkspace(db, workspaceId);
		if (!workspace) {
			logger.warn({ workspaceId }, "Workspace not found, skipping delete job");
			return;
		}

		logger.info({ workspaceId, name: workspace.name }, "Deleting workspace");

		await removePortRoutes(workspaceId, workspace.name);
		await runtime.stop(workspace.name).catch(() => {});
		await runtime.remove(workspace.name).catch(() => {});
		await caddy.removeWorkspaceRoute(workspace.name);
		await deleteWorkspace(db, workspaceId);

		logger.info({ workspaceId, name: workspace.name }, "Workspace deleted");
	}

	return {
		async process(job: WorkspaceJob): Promise<void> {
			const handler = {
				create: handleCreate,
				start: handleStart,
				stop: handleStop,
				delete: handleDelete,
			}[job.type];

			if (!handler) {
				logger.error({ jobType: job.type }, "Unknown job type");
				return;
			}

			try {
				await handler(job.workspaceId);
			} catch (err) {
				logger.error(
					{ err, workspaceId: job.workspaceId, jobType: job.type },
					"Job processing failed",
				);
				await updateWorkspaceStatus(db, job.workspaceId, "error", {
					errorMessage: err instanceof Error ? err.message : String(err),
				}).catch(() => {});
			}
		},
	};
}
