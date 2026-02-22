import { createCaddyClient } from "@tdpl/caddy";
import { createDb } from "@tdpl/db";
import { createMemoryQueue, createSqsQueue } from "@tdpl/queue";
import pino from "pino";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createPortService } from "./services/port-service.ts";
import { createWorkspaceService } from "./services/workspace-service.ts";

const config = loadConfig();
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const db = createDb(config.dbPath);

const queue =
	process.env.NODE_ENV === "test"
		? createMemoryQueue()
		: createSqsQueue({
				endpoint: config.queueEndpoint,
				queueUrl: config.queueUrl,
			});

const caddy = createCaddyClient({ adminUrl: config.caddyAdminUrl });
const workspaceService = createWorkspaceService({ db, queue });
const portService = createPortService({ db, caddy });

const app = createApp({ workspaceService, portService, logger });

app.listen(config.port, () => {
	logger.info({ port: config.port }, "Tidepool control plane started");
});

export { createApp } from "./app.ts";
export { createPortService } from "./services/port-service.ts";
export {
	ConflictError,
	createWorkspaceService,
	NotFoundError,
} from "./services/workspace-service.ts";
