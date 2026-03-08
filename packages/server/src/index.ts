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

const port = Number.parseInt(process.env.PORT ?? "7163", 10);
const caddyAdminUrl = process.env.CADDY_ADMIN_URL ?? "http://localhost:2019";
const srv0Port = Number.parseInt(process.env.SRV0_PORT ?? "8080", 10);
const srv1Port = Number.parseInt(process.env.SRV1_PORT ?? "8081", 10);
const srv2Port = Number.parseInt(process.env.SRV2_PORT ?? "8082", 10);
const dbPath = process.env.DB_PATH ?? "rockpool.db";
const queueEndpoint = process.env.QUEUE_ENDPOINT ?? "http://localhost:9324";
const queueUrl = process.env.QUEUE_URL ?? "http://localhost:9324/000000000000/workspace-jobs";
const hostAddress = process.env.CONTAINER_HOST_ADDRESS ?? "host.containers.internal";

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
		return createPodmanRuntime({ hostAddress });
	}

	throw new Error(`Unsupported runtime: ${config.runtime}`);
}

const db = createDb(dbPath);

const queue = createSqsQueue({
	endpoint: queueEndpoint,
	queueUrl,
});

const controlPlaneHost = process.env.CONTROL_PLANE_HOST ?? "127.0.0.1";

function resolveAuthMode(): AuthMode | undefined {
	if (hasOAuth) {
		return {
			mode: "oauth",
			controlPlaneDial: `${controlPlaneHost}:${port}`,
			srv0Port,
		};
	}
	return undefined;
}

const authMode = resolveAuthMode();

const caddy = createCaddyClient({ adminUrl: caddyAdminUrl, authMode });
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
	const controlPlaneUrl = `http://${controlPlaneHost}:${port}`;

	const bootstrapOptions: BootstrapOptions = {
		controlPlaneUrl,
		srv0Port,
		srv1Port,
		srv2Port,
		adminUrl: caddyAdminUrl,
	};

	const spaProxyUrl = process.env.SPA_PROXY_URL || config.spa.proxyUrl;
	if (spaProxyUrl) {
		bootstrapOptions.spaProxyUrl = spaProxyUrl;
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

		if (vmStatus === "running" && ws.containerIp) {
			await caddy.addWorkspaceRoute(ws.name, ws.containerIp);
			logger.info(
				{ workspaceId: ws.id, name: ws.name, containerIp: ws.containerIp },
				"Recovered Caddy route for running workspace",
			);

			const workspacePorts = await listPorts(db, ws.id);
			for (const p of workspacePorts) {
				await caddy.addPortRoute(ws.name, ws.containerIp, p.port);
				logger.info(
					{ workspaceId: ws.id, name: ws.name, port: p.port },
					"Recovered Caddy port route",
				);
			}
			continue;
		}

		logger.warn(
			{ workspaceId: ws.id, name: ws.name, vmStatus },
			"DB says running but container is not, re-enqueuing start",
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

app.listen(port, () => {
	logger.info({ port }, "Rockpool control plane started");

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
