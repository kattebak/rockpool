import type { BootstrapOptions } from "@tdpl/caddy";
import {
	buildBootstrapConfig,
	createCaddyClient,
	createStubCaddy,
	hashPassword,
} from "@tdpl/caddy";
import { createDb } from "@tdpl/db";
import { createMemoryQueue, createSqsQueue } from "@tdpl/queue";
import { createStubRuntime, createTartRuntime } from "@tdpl/runtime";
import { createPollLoop, createProcessor } from "@tdpl/worker";
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
const workspaceService = createWorkspaceService({ db, queue });
const portService = createPortService({ db, caddy });

const app = createApp({ workspaceService, portService, logger });

async function bootstrapCaddy(): Promise<void> {
	const controlPlaneUrl = `http://localhost:${config.port}`;

	const bootstrapOptions: BootstrapOptions = {
		controlPlaneUrl,
		srv1Port: config.srv1Port,
	};

	if (config.spaRoot) {
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

app.listen(config.port, () => {
	logger.info({ port: config.port }, "Tidepool control plane started");

	if (inlineWorker) {
		const runtime = useStubVm
			? createStubRuntime()
			: createTartRuntime({ sshKeyPath: config.sshKeyPath });
		const healthCheck = useStubVm ? async () => {} : undefined;
		const processor = createProcessor({ db, runtime, caddy, logger, healthCheck });
		const pollLoop = createPollLoop({ queue, processor, logger });

		logger.info({ runtime: useStubVm ? "stub" : "tart" }, "Starting in-process worker");
		pollLoop.start();
	}

	if (!useStubs) {
		bootstrapCaddy().catch((err) => {
			logger.error(err, "Failed to bootstrap Caddy");
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
