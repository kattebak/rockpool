import type { BootstrapOptions } from "@rockpool/caddy";
import {
	buildBootstrapConfig,
	createCaddyClient,
	createStubCaddy,
	hashPassword,
} from "@rockpool/caddy";
import { createDb, listPorts, listWorkspacesByStatus, updateWorkspaceStatus } from "@rockpool/db";
import type { QueueRepository } from "@rockpool/queue";
import { createMemoryQueue, createSqsQueue } from "@rockpool/queue";
import type { RuntimeRepository } from "@rockpool/runtime";
import { createStubRuntime, createTartRuntime } from "@rockpool/runtime";
import { createPollLoop, createProcessor } from "@rockpool/worker";
import pino from "pino";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createPortService } from "./services/port-service.ts";
import { createWorkspaceService } from "./services/workspace-service.ts";

const config = loadConfig();
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const useStubs = process.env.NODE_ENV === "test";
const inlineWorker = useStubs || process.env.WORKER_INLINE === "true";
const useStubVm = process.env.RUNTIME !== "tart";

const db = createDb(config.dbPath);

const queue = inlineWorker
	? createMemoryQueue()
	: createSqsQueue({
			endpoint: config.queueEndpoint,
			queueUrl: config.queueUrl,
		});

const caddy = useStubs ? createStubCaddy() : createCaddyClient({ adminUrl: config.caddyAdminUrl });
const runtime = useStubVm
	? createStubRuntime()
	: createTartRuntime({ sshKeyPath: config.sshKeyPath });

const healthCheck = useStubVm ? async () => {} : undefined;
const workspaceService = createWorkspaceService({ db, queue, runtime, caddy, logger, healthCheck });
const portService = createPortService({ db, caddy });

const app = createApp({ workspaceService, portService, logger });

async function bootstrapCaddy(): Promise<void> {
	const controlPlaneUrl = `http://localhost:${config.port}`;

	const bootstrapOptions: BootstrapOptions = {
		controlPlaneUrl,
		srv1Port: config.srv1Port,
	};

	if (config.spaProxyUrl) {
		bootstrapOptions.spaProxyUrl = config.spaProxyUrl;
	} else if (config.spaRoot) {
		bootstrapOptions.spaRoot = config.spaRoot;
	}

	if (config.caddyUsername && config.caddyPassword) {
		const passwordHash = await hashPassword(config.caddyPassword);
		bootstrapOptions.auth = {
			username: config.caddyUsername,
			passwordHash,
		};
	}

	const caddyConfig = buildBootstrapConfig(bootstrapOptions);
	await caddy.bootstrap(caddyConfig);
	logger.info(
		{
			controlPlaneUrl,
			spaRoot: config.spaRoot || "(none)",
			auth: Boolean(config.caddyUsername),
		},
		"Caddy bootstrapped",
	);
}

async function recoverRunningWorkspaces(
	runtime: RuntimeRepository,
	q: QueueRepository,
): Promise<void> {
	const running = await listWorkspacesByStatus(db, "running");
	for (const ws of running) {
		const vmStatus = await runtime.status(ws.name);

		if (vmStatus === "running" && ws.vmIp) {
			await caddy.addWorkspaceRoute(ws.name, ws.vmIp);
			logger.info(
				{ workspaceId: ws.id, name: ws.name, vmIp: ws.vmIp },
				"Recovered Caddy route for running workspace",
			);

			const workspacePorts = await listPorts(db, ws.id);
			for (const p of workspacePorts) {
				await caddy.addPortRoute(ws.name, ws.vmIp, p.port);
				logger.info(
					{ workspaceId: ws.id, name: ws.name, port: p.port },
					"Recovered Caddy port route",
				);
			}
			continue;
		}

		logger.warn(
			{ workspaceId: ws.id, name: ws.name, vmStatus },
			"DB says running but VM is not, re-enqueuing start",
		);
		await updateWorkspaceStatus(db, ws.id, "stopped");
		await q.send({ type: "start", workspaceId: ws.id });
	}
	if (running.length > 0) {
		logger.info({ count: running.length }, "Running workspace recovery complete");
	}
}

async function recoverOrphanedWorkspaces(q: QueueRepository): Promise<void> {
	const orphaned = await listWorkspacesByStatus(db, "creating");
	for (const ws of orphaned) {
		logger.info({ workspaceId: ws.id, name: ws.name }, "Re-enqueuing orphaned workspace");
		await q.send({ type: "create", workspaceId: ws.id });
	}
	if (orphaned.length > 0) {
		logger.info({ count: orphaned.length }, "Orphaned workspace recovery complete");
	}
}

app.listen(config.port, () => {
	logger.info({ port: config.port }, "Rockpool control plane started");

	if (inlineWorker) {
		const processor = createProcessor({ workspaceService, logger });
		const pollLoop = createPollLoop({ queue, processor, logger });

		logger.info({ runtime: useStubVm ? "stub" : "tart" }, "Starting in-process worker");
		recoverOrphanedWorkspaces(queue).catch((err) => {
			logger.error(err, "Failed to recover orphaned workspaces");
		});
		pollLoop.start();
	}

	if (!useStubs) {
		bootstrapCaddy()
			.then(() => recoverRunningWorkspaces(runtime, queue))
			.catch((err) => {
				logger.error(err, "Failed to bootstrap Caddy or recover workspaces");
			});
	}
});

export { createApp } from "./app.ts";
export { createPortService } from "./services/port-service.ts";
export {
	ConflictError,
	createWorkspaceService,
	NotFoundError,
} from "./services/workspace-service.ts";
