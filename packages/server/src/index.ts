import { createAuthService } from "@rockpool/auth";
import type { AuthMode, BootstrapOptions } from "@rockpool/caddy";
import {
	buildBootstrapConfig,
	createCaddyClient,
	createStubCaddy,
	hashPassword,
} from "@rockpool/caddy";
import { createDb, listPorts, listWorkspacesByStatus, updateWorkspaceStatus } from "@rockpool/db";
import { WorkspaceStatus as WS } from "@rockpool/enums";
import type { QueueRepository } from "@rockpool/queue";
import { createSqsQueue } from "@rockpool/queue";
import type { RuntimeRepository } from "@rockpool/runtime";
import { createStubRuntime, createTartRuntime } from "@rockpool/runtime";
import pino from "pino";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createPortService } from "./services/port-service.ts";
import { createWorkspaceService } from "./services/workspace-service.ts";

const config = loadConfig();
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const useStubs = process.env.NODE_ENV === "test";

const hasBasicAuth = Boolean(config.caddyUsername && config.caddyPassword);
const hasOAuth = Boolean(config.auth);

if (!useStubs && !hasBasicAuth && !hasOAuth) {
	throw new Error(
		"Authentication required: set GITHUB_OAUTH_CLIENT_ID + GITHUB_OAUTH_CLIENT_SECRET, or CADDY_USERNAME + CADDY_PASSWORD",
	);
}
const useStubVm = process.env.RUNTIME !== "tart";

const db = createDb(config.dbPath);

const queue = createSqsQueue({
	endpoint: config.queueEndpoint,
	queueUrl: config.queueUrl,
});

function resolveAuthMode(): AuthMode | undefined {
	if (hasOAuth) {
		const host = "127.0.0.1";
		return { mode: "oauth", controlPlaneDial: `${host}:${config.port}`, srv0Port: config.srv0Port };
	}
	return undefined;
}

const authMode = resolveAuthMode();

const caddy = useStubs
	? createStubCaddy()
	: createCaddyClient({ adminUrl: config.caddyAdminUrl, authMode });
const runtime = useStubVm
	? createStubRuntime()
	: createTartRuntime({ sshKeyPath: config.sshKeyPath });

const healthCheck = useStubVm ? async () => {} : undefined;
const workspaceService = createWorkspaceService({ db, queue, runtime, caddy, logger, healthCheck });
const portService = createPortService({ db, caddy });

const authService = config.auth ? createAuthService(config.auth) : null;

const app = createApp({
	workspaceService,
	portService,
	logger,
	authService,
	secureCookies: config.secureCookies,
	db,
});

async function bootstrapCaddy(): Promise<void> {
	const controlPlaneUrl = `http://localhost:${config.port}`;

	const bootstrapOptions: BootstrapOptions = {
		controlPlaneUrl,
		srv0Port: config.srv0Port,
		srv1Port: config.srv1Port,
	};

	if (config.spaProxyUrl) {
		bootstrapOptions.spaProxyUrl = config.spaProxyUrl;
	} else if (config.spaRoot) {
		bootstrapOptions.spaRoot = config.spaRoot;
	}

	if (hasBasicAuth && !hasOAuth) {
		const passwordHash = await hashPassword(config.caddyPassword);
		bootstrapOptions.authMode = {
			mode: "basic",
			credentials: { username: config.caddyUsername, passwordHash },
		};
	} else if (authMode) {
		bootstrapOptions.authMode = authMode;
	}

	const caddyConfig = buildBootstrapConfig(bootstrapOptions);
	await caddy.bootstrap(caddyConfig);
	logger.info(
		{
			controlPlaneUrl,
			spaRoot: config.spaRoot || "(none)",
			authMode: hasOAuth ? "oauth" : "basic",
		},
		"Caddy bootstrapped",
	);
}

async function recoverRunningWorkspaces(
	runtime: RuntimeRepository,
	q: QueueRepository,
): Promise<void> {
	const running = await listWorkspacesByStatus(db, WS.running);
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
		await updateWorkspaceStatus(db, ws.id, WS.stopped);
		await q.send({ type: "start", workspaceId: ws.id });
	}
	if (running.length > 0) {
		logger.info({ count: running.length }, "Running workspace recovery complete");
	}
}

async function recoverOrphanedWorkspaces(q: QueueRepository): Promise<void> {
	const orphaned = await listWorkspacesByStatus(db, WS.creating);
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

	if (!useStubs) {
		bootstrapCaddy()
			.then(() => recoverRunningWorkspaces(runtime, queue))
			.then(() => recoverOrphanedWorkspaces(queue))
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
