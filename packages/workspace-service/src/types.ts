import type { CaddyRepository } from "@rockpool/caddy";
import type { DbClient } from "@rockpool/db";
import type { QueueRepository } from "@rockpool/queue";
import type { RuntimeRepository } from "@rockpool/runtime";

export interface WorkspaceServiceDeps {
	db: DbClient;
	queue: QueueRepository;
	runtime: RuntimeRepository;
	caddy: CaddyRepository;
}
