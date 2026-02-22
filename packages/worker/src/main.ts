import { createCaddyClient } from "@tdpl/caddy";
import { createDb } from "@tdpl/db";
import { createSqsQueue } from "@tdpl/queue";
import { createTartRuntime } from "@tdpl/runtime";
import pino from "pino";
import { createPollLoop } from "./poll-loop.ts";
import { createProcessor } from "./processor.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const db = createDb(process.env.DB_PATH ?? "tidepool.db");

const queue = createSqsQueue({
	endpoint: process.env.QUEUE_ENDPOINT ?? "http://localhost:9324",
	queueUrl: process.env.QUEUE_URL ?? "http://localhost:9324/000000000000/workspace-jobs",
});

const caddy = createCaddyClient({
	adminUrl: process.env.CADDY_ADMIN_URL ?? "http://localhost:2019",
});

const runtime = createTartRuntime();

const processor = createProcessor({ db, runtime, caddy, logger });
const pollLoop = createPollLoop({ queue, processor, logger });

logger.info("Worker starting");
pollLoop.start();

process.on("SIGINT", () => {
	logger.info("Worker shutting down");
	pollLoop.stop();
});

process.on("SIGTERM", () => {
	logger.info("Worker shutting down");
	pollLoop.stop();
});
