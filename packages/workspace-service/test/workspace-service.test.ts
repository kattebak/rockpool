import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { CaddyRepository } from "@rockpool/caddy";
import type { DbClient } from "@rockpool/db";
import {
	addPort,
	createMemoryDb,
	createWorkspace,
	getWorkspace,
	listPorts,
} from "@rockpool/db";
import { createMemoryQueue } from "@rockpool/queue";
import type { RuntimeRepository, VmStatus } from "@rockpool/runtime";
import pino from "pino";
import { createWorkspaceService } from "../src/workspace-service.ts";

const logger = pino({ level: "silent" });

function createMockRuntime(
	vmStatus: VmStatus = "not_found",
): RuntimeRepository & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async create(name: string, _image: string) {
			calls.push(`create:${name}`);
		},
		async start(name: string) {
			calls.push(`start:${name}`);
		},
		async stop(name: string) {
			calls.push(`stop:${name}`);
		},
		async remove(name: string) {
			calls.push(`remove:${name}`);
		},
		async status(_name: string) {
			return vmStatus;
		},
		async getIp(_name: string) {
			return "10.0.1.50";
		},
		async configure(name: string, _env: Record<string, string>) {
			calls.push(`configure:${name}`);
		},
	};
}

function createMockCaddy(): CaddyRepository & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async addWorkspaceRoute(name: string, _vmIp: string) {
			calls.push(`addRoute:${name}`);
		},
		async removeWorkspaceRoute(name: string) {
			calls.push(`removeRoute:${name}`);
		},
		async addPortRoute(workspaceName: string, _vmIp: string, port: number) {
			calls.push(`addPort:${workspaceName}:${port}`);
		},
		async removePortRoute(workspaceName: string, port: number) {
			calls.push(`removePort:${workspaceName}:${port}`);
		},
		async bootstrap(_config: unknown) {
			calls.push("bootstrap");
		},
	};
}

async function noopHealthCheck(_vmIp: string): Promise<void> {}

describe("provisionAndStart", () => {
	let db: DbClient;

	before(() => {
		db = createMemoryDb();
	});

	it("creates VM, starts it, configures, adds route, updates status to running", async () => {
		const ws = await createWorkspace(db, { name: "prov-create", image: "alpine-v1" });
		const runtime = createMockRuntime("not_found");
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.provisionAndStart(ws.id);

		assert.deepEqual(runtime.calls, [
			"create:prov-create",
			"start:prov-create",
			"configure:prov-create",
		]);
		assert.deepEqual(caddy.calls, ["addRoute:prov-create"]);

		const updated = await getWorkspace(db, ws.id);
		assert.equal(updated?.status, "running");
		assert.equal(updated?.vmIp, "10.0.1.50");
	});

	it("starts stopped VM without creating it", async () => {
		const ws = await createWorkspace(db, { name: "prov-start-stopped", image: "alpine-v1" });
		const runtime = createMockRuntime("stopped");
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.provisionAndStart(ws.id);

		assert.deepEqual(runtime.calls, ["start:prov-start-stopped", "configure:prov-start-stopped"]);
		assert.deepEqual(caddy.calls, ["addRoute:prov-start-stopped"]);

		const updated = await getWorkspace(db, ws.id);
		assert.equal(updated?.status, "running");
		assert.equal(updated?.vmIp, "10.0.1.50");
	});

	it("skips create and start when VM already running (idempotent)", async () => {
		const ws = await createWorkspace(db, { name: "prov-running", image: "alpine-v1" });
		const runtime = createMockRuntime("running");
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.provisionAndStart(ws.id);

		assert.deepEqual(runtime.calls, ["configure:prov-running"]);
		assert.deepEqual(caddy.calls, ["addRoute:prov-running"]);

		const updated = await getWorkspace(db, ws.id);
		assert.equal(updated?.status, "running");
		assert.equal(updated?.vmIp, "10.0.1.50");
	});

	it("skips silently when workspace not found", async () => {
		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.provisionAndStart("nonexistent-id");

		assert.deepEqual(runtime.calls, []);
		assert.deepEqual(caddy.calls, []);
	});
});

describe("teardown (stop)", () => {
	let db: DbClient;

	before(() => {
		db = createMemoryDb();
	});

	it("removes ports, stops VM, removes route, updates status to stopped", async () => {
		const ws = await createWorkspace(db, { name: "tear-stop", image: "alpine-v1" });
		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.teardown(ws.id, "stop");

		assert.deepEqual(runtime.calls, ["stop:tear-stop"]);
		assert.deepEqual(caddy.calls, ["removeRoute:tear-stop"]);

		const updated = await getWorkspace(db, ws.id);
		assert.equal(updated?.status, "stopped");
		assert.equal(updated?.vmIp, null);
	});

	it("cascades port cleanup on stop", async () => {
		const ws = await createWorkspace(db, { name: "tear-stop-ports", image: "alpine-v1" });
		await addPort(db, { workspaceId: ws.id, port: 3000 });
		await addPort(db, { workspaceId: ws.id, port: 5000 });

		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.teardown(ws.id, "stop");

		const remainingPorts = await listPorts(db, ws.id);
		assert.deepEqual(remainingPorts, []);
	});

	it("skips silently when workspace not found", async () => {
		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.teardown("nonexistent-id", "stop");

		assert.deepEqual(runtime.calls, []);
		assert.deepEqual(caddy.calls, []);
	});
});

describe("teardown (delete)", () => {
	let db: DbClient;

	before(() => {
		db = createMemoryDb();
	});

	it("stops VM, removes VM, removes route, deletes from DB", async () => {
		const ws = await createWorkspace(db, { name: "tear-delete", image: "alpine-v1" });
		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.teardown(ws.id, "delete");

		assert.deepEqual(runtime.calls, ["stop:tear-delete", "remove:tear-delete"]);
		assert.deepEqual(caddy.calls, ["removeRoute:tear-delete"]);

		const deleted = await getWorkspace(db, ws.id);
		assert.equal(deleted, undefined);
	});

	it("ignores errors when stopping VM during delete", async () => {
		const ws = await createWorkspace(db, { name: "tear-delete-err", image: "alpine-v1" });
		const runtime = createMockRuntime();
		runtime.stop = async () => {
			throw new Error("VM already stopped");
		};
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.teardown(ws.id, "delete");

		assert.deepEqual(runtime.calls, ["remove:tear-delete-err"]);
		assert.deepEqual(caddy.calls, ["removeRoute:tear-delete-err"]);

		const deleted = await getWorkspace(db, ws.id);
		assert.equal(deleted, undefined);
	});

	it("ignores errors when removing VM during delete", async () => {
		const ws = await createWorkspace(db, { name: "tear-delete-rm-err", image: "alpine-v1" });
		const runtime = createMockRuntime();
		runtime.remove = async () => {
			throw new Error("VM not found");
		};
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.teardown(ws.id, "delete");

		assert.deepEqual(runtime.calls, ["stop:tear-delete-rm-err"]);
		assert.deepEqual(caddy.calls, ["removeRoute:tear-delete-rm-err"]);

		const deleted = await getWorkspace(db, ws.id);
		assert.equal(deleted, undefined);
	});

	it("skips silently when workspace not found", async () => {
		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.teardown("nonexistent-id", "delete");

		assert.deepEqual(runtime.calls, []);
		assert.deepEqual(caddy.calls, []);
	});
});

describe("setError", () => {
	it("sets error status and message on workspace", async () => {
		const db = createMemoryDb();
		const ws = await createWorkspace(db, { name: "set-error-test", image: "alpine-v1" });
		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.setError(ws.id, "Something went wrong");

		const updated = await getWorkspace(db, ws.id);
		assert.equal(updated?.status, "error");
		assert.equal(updated?.errorMessage, "Something went wrong");
	});

	it("does not throw when workspace does not exist", async () => {
		const db = createMemoryDb();
		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const queue = createMemoryQueue();
		const service = createWorkspaceService({
			db,
			queue,
			runtime,
			caddy,
			logger,
			healthCheck: noopHealthCheck,
		});

		await service.setError("nonexistent-id", "error message");
	});
});
