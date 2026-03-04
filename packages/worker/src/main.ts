import { createCaddyClient } from "@rockpool/caddy";
import { loadConfig } from "@rockpool/config";
import { createDb } from "@rockpool/db";
import { createSqsQueue } from "@rockpool/queue";
import { createPodmanRuntime } from "@rockpool/runtime";
import { createWorkspaceService } from "@rockpool/workspace-service";
import pino from "pino";
import { createPollLoop } from "./poll-loop.ts";
import { createProcessor } from "./processor.ts";

const config = loadConfig();
const logger = pino({ level: config.logLevel });

const dbPath = process.env.DB_PATH ?? "rockpool.db";
const queueEndpoint = process.env.QUEUE_ENDPOINT ?? "http://localhost:9324";
const queueUrl = process.env.QUEUE_URL ?? "http://localhost:9324/000000000000/workspace-jobs";
const caddyAdminUrl = process.env.CADDY_ADMIN_URL ?? "http://localhost:2019";
const hostAddress = process.env.CONTAINER_HOST_ADDRESS ?? "host.containers.internal";

const db = createDb(dbPath);

const queue = createSqsQueue({
	endpoint: queueEndpoint,
	queueUrl,
});

const caddy = createCaddyClient({
	adminUrl: caddyAdminUrl,
});

function createRuntimeFromConfig() {
	if (config.runtime === "podman") {
		return createPodmanRuntime({ hostAddress });
	}

	throw new Error(`Unsupported runtime: ${config.runtime}`);
}

const runtime = createRuntimeFromConfig();
const workspaceService = createWorkspaceService({ db, queue, runtime, caddy, logger });
const processor = createProcessor({ workspaceService, logger });
const pollLoop = createPollLoop({ queue, processor, logger });

logger.info({ runtime: config.runtime }, "Worker starting");
pollLoop.start();

process.on("SIGINT", () => {
	logger.info("Worker shutting down");
	pollLoop.stop();
});

process.on("SIGTERM", () => {
	logger.info("Worker shutting down");
	pollLoop.stop();
});
