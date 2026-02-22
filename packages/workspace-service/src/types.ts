import type { CaddyRepository } from "@rockpool/caddy";
import type { DbClient } from "@rockpool/db";
import type { QueueRepository } from "@rockpool/queue";
import type { RuntimeRepository } from "@rockpool/runtime";
import type { Logger } from "pino";
import type { HealthCheckFn } from "./health-check.ts";

export interface WorkspaceServiceDeps {
	db: DbClient;
	queue: QueueRepository;
	runtime: RuntimeRepository;
	caddy: CaddyRepository;
	logger: Logger;
	healthCheck?: HealthCheckFn;
}
