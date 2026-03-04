import type { AuthConfig } from "@rockpool/auth";
import { createAuthService } from "@rockpool/auth";
import type { AuthMode, BootstrapOptions } from "@rockpool/caddy";
import { buildBootstrapConfig, createCaddyClient, hashPassword } from "@rockpool/caddy";
import type { RockpoolConfig } from "@rockpool/config";
import { createDb, listPorts, listWorkspacesByStatus, updateWorkspaceStatus } from "@rockpool/db";
import { WorkspaceStatus as WS } from "@rockpool/enums";
import type { QueueRepository } from "@rockpool/queue";
import { createSqsQueue } from "@rockpool/queue";
import type { RuntimeRepository } from "@rockpool/runtime";
import { createPodmanRuntime } from "@rockpool/runtime";
import pino from "pino";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createPortService } from "./services/port-service.ts";
import { createWorkspaceService } from "./services/workspace-service.ts";

const config = loadConfig();
const logger = pino({ level: config.logLevel });

function resolveAuth(cfg: RockpoolConfig): AuthConfig | null {
	if (cfg.auth.mode === "github" && cfg.auth.github) {
		return {
			clientId: cfg.auth.github.clientId,
			clientSecret: cfg.auth.github.clientSecret,
			callbackUrl: cfg.auth.github.callbackUrl,
			sessionMaxAgeMs: cfg.auth.github.sessionMaxAgeMs,
		};
	}
	return null;
}

const oauthConfig = resolveAuth(config);
const hasBasicAuth = config.auth.mode === "basic" && config.auth.basic !== undefined;
const hasOAuth = oauthConfig !== null;

function createRuntimeFromConfig(): RuntimeRepository {
	if (config.runtime === "podman") {
		return createPodmanRuntime({ hostAddress: config.container.hostAddress });
	}

	throw new Error(`Unsupported runtime: ${config.runtime}`);
}

const db = createDb(config.db.path);

const queue = createSqsQueue({
	endpoint: config.queue.endpoint,
	queueUrl: config.queue.queueUrl,
});

const controlPlaneHost = process.env.CONTROL_PLANE_HOST ?? "127.0.0.1";

function resolveAuthMode(): AuthMode | undefined {
	if (hasOAuth) {
		return {
			mode: "oauth",
			controlPlaneDial: `${controlPlaneHost}:${config.server.port}`,
			srv0Port: config.caddy.srv0Port,
		};
	}
	return undefined;
}

const authMode = resolveAuthMode();

const caddy = createCaddyClient({ adminUrl: config.caddy.adminUrl, authMode });
const runtime = createRuntimeFromConfig();
const workspaceService = createWorkspaceService({ db, queue, runtime, caddy, logger });
const portService = createPortService({ db, caddy });

const authService = oauthConfig ? createAuthService(oauthConfig) : null;

const app = createApp({
	workspaceService,
	portService,
	settingsRouterDeps: { db, runtime },
	logger,
	authService,
	secureCookies: config.server.secureCookies,
	db,
	spaRoot: config.spa.root || undefined,
});

async function bootstrapCaddy(): Promise<void> {
	const controlPlaneUrl = `http://${controlPlaneHost}:${config.server.port}`;

	const bootstrapOptions: BootstrapOptions = {
		controlPlaneUrl,
		srv0Port: config.caddy.srv0Port,
		srv1Port: config.caddy.srv1Port,
		srv2Port: config.caddy.srv2Port,
		adminUrl: config.caddy.adminUrl,
	};

	if (config.spa.proxyUrl) {
		bootstrapOptions.spaProxyUrl = config.spa.proxyUrl;
	} else if (config.spa.root) {
		bootstrapOptions.spaRoot = config.spa.root;
	}

	if (hasBasicAuth && !hasOAuth && config.auth.basic) {
		const passwordHash = await hashPassword(config.auth.basic.password);
		bootstrapOptions.authMode = {
			mode: "basic",
			credentials: { username: config.auth.basic.username, passwordHash },
		};
	} else if (authMode) {
		bootstrapOptions.authMode = authMode;
	}

	const caddyConfig = buildBootstrapConfig(bootstrapOptions);
	await caddy.bootstrap(caddyConfig);
	logger.info(
		{
			controlPlaneUrl,
			spaRoot: config.spa.root || "(none)",
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

app.listen(config.server.port, () => {
	logger.info({ port: config.server.port }, "Rockpool control plane started");

	bootstrapCaddy()
		.then(() => recoverRunningWorkspaces(runtime, queue))
		.then(() => recoverOrphanedWorkspaces(queue))
		.catch((err) => {
			logger.error(err, "Failed to bootstrap Caddy or recover workspaces");
		});
});

export { createApp } from "./app.ts";
export { createPortService } from "./services/port-service.ts";
export {
	ConflictError,
	createWorkspaceService,
	NotFoundError,
} from "./services/workspace-service.ts";
