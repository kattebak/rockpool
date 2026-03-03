import { resolve } from "node:path";
import { createCaddyClient } from "@rockpool/caddy";
import { createDb } from "@rockpool/db";
import { createSqsQueue } from "@rockpool/queue";
import type { RuntimeRepository } from "@rockpool/runtime";
import { createPodmanRuntime, createTartRuntime } from "@rockpool/runtime";
import { createWorkspaceService } from "@rockpool/workspace-service";
import pino from "pino";
import { createPollLoop } from "./poll-loop.ts";
import { createProcessor } from "./processor.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const projectRoot = new URL("../../..", import.meta.url).pathname;

const dbPath = resolve(projectRoot, process.env.DB_PATH ?? "rockpool.db");
const db = createDb(dbPath);

const queue = createSqsQueue({
	endpoint: process.env.QUEUE_ENDPOINT ?? "http://localhost:9324",
	queueUrl: process.env.QUEUE_URL ?? "http://localhost:9324/000000000000/workspace-jobs",
});

const caddy = createCaddyClient({
	adminUrl: process.env.CADDY_ADMIN_URL ?? "http://localhost:2019",
});

const sshKeyPath = resolve(projectRoot, process.env.SSH_KEY_PATH ?? "images/ssh/rockpool_ed25519");
const platform = (process.env.PLATFORM ?? process.platform) as "darwin" | "linux";

function createRuntimeFromEnv(): RuntimeRepository {
	const runtimeEnv = process.env.RUNTIME;
	const hostAddress = process.env.CONTAINER_HOST_ADDRESS;

	if (runtimeEnv === "podman") {
		return createPodmanRuntime({ hostAddress });
	}

	if (runtimeEnv === "tart" || (!runtimeEnv && platform === "darwin")) {
		return createTartRuntime({ sshKeyPath });
	}

	return createPodmanRuntime({ hostAddress });
}

const runtime = createRuntimeFromEnv();
const workspaceService = createWorkspaceService({ db, queue, runtime, caddy, logger });
const processor = createProcessor({ workspaceService, logger });
const pollLoop = createPollLoop({ queue, processor, logger });

logger.info({ sshKeyPath, platform, runtime: process.env.RUNTIME ?? "auto" }, "Worker starting");
pollLoop.start();

process.on("SIGINT", () => {
	logger.info("Worker shutting down");
	pollLoop.stop();
});

process.on("SIGTERM", () => {
	logger.info("Worker shutting down");
	pollLoop.stop();
});
