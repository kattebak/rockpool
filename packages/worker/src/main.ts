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

const db = createDb(config.db.path);

const queue = createSqsQueue({
	endpoint: config.queue.endpoint,
	queueUrl: config.queue.queueUrl,
});

const caddy = createCaddyClient({
	adminUrl: config.caddy.adminUrl,
});

function createRuntimeFromConfig() {
	if (config.runtime === "podman") {
		return createPodmanRuntime({ hostAddress: config.container.hostAddress });
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
