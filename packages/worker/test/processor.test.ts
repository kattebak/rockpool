import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { CaddyRepository } from "@tdpl/caddy";
import type { DbClient } from "@tdpl/db";
import { addPort, createMemoryDb, createWorkspace, getWorkspace, listPorts } from "@tdpl/db";
import type { RuntimeRepository } from "@tdpl/runtime";
import pino from "pino";
import { createProcessor } from "../src/processor.ts";

function createMockRuntime(): RuntimeRepository & { calls: string[] } {
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
			return "running" as const;
		},
		async getIp(_name: string) {
			return "10.0.1.50";
		},
		async configure(name: string, _env: Record<string, string>) {
			calls.push(`configure:${name}`);
		},
	};
}

async function noopHealthCheck(_vmIp: string): Promise<void> {}

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

describe("Processor", () => {
	let db: DbClient;
	const logger = pino({ level: "silent" });

	before(() => {
		db = createMemoryDb();
	});

	it("handles create job: creates VM, gets IP, adds route, updates status", async () => {
		const ws = await createWorkspace(db, { name: "proc-create", image: "alpine-v1" });
		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const processor = createProcessor({ db, runtime, caddy, logger, healthCheck: noopHealthCheck });

		await processor.process({ type: "create", workspaceId: ws.id });

		assert.deepEqual(runtime.calls, [
			"create:proc-create",
			"start:proc-create",
			"configure:proc-create",
		]);
		assert.deepEqual(caddy.calls, ["addRoute:proc-create"]);

		const updated = await getWorkspace(db, ws.id);
		assert.equal(updated?.status, "running");
		assert.equal(updated?.vmIp, "10.0.1.50");
	});

	it("handles stop job: stops VM, removes route, updates status", async () => {
		const ws = await createWorkspace(db, { name: "proc-stop", image: "alpine-v1" });
		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const processor = createProcessor({ db, runtime, caddy, logger, healthCheck: noopHealthCheck });

		await processor.process({ type: "stop", workspaceId: ws.id });

		assert.deepEqual(runtime.calls, ["stop:proc-stop"]);
		assert.deepEqual(caddy.calls, ["removeRoute:proc-stop"]);

		const updated = await getWorkspace(db, ws.id);
		assert.equal(updated?.status, "stopped");
		assert.equal(updated?.vmIp, null);
	});

	it("handles delete job: stops VM, removes VM, removes route, deletes from DB", async () => {
		const ws = await createWorkspace(db, { name: "proc-delete", image: "alpine-v1" });
		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const processor = createProcessor({ db, runtime, caddy, logger, healthCheck: noopHealthCheck });

		await processor.process({ type: "delete", workspaceId: ws.id });

		assert.deepEqual(runtime.calls, ["stop:proc-delete", "remove:proc-delete"]);
		assert.deepEqual(caddy.calls, ["removeRoute:proc-delete"]);

		const deleted = await getWorkspace(db, ws.id);
		assert.equal(deleted, undefined);
	});

	it("sets error status when job fails", async () => {
		const ws = await createWorkspace(db, { name: "proc-error", image: "alpine-v1" });
		const runtime = createMockRuntime();
		runtime.create = async () => {
			throw new Error("VM creation failed");
		};
		const caddy = createMockCaddy();
		const processor = createProcessor({ db, runtime, caddy, logger, healthCheck: noopHealthCheck });

		await processor.process({ type: "create", workspaceId: ws.id });

		const updated = await getWorkspace(db, ws.id);
		assert.equal(updated?.status, "error");
		assert.equal(updated?.errorMessage, "VM creation failed");
	});

	it("skips job when workspace not found", async () => {
		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const processor = createProcessor({ db, runtime, caddy, logger, healthCheck: noopHealthCheck });

		await processor.process({ type: "create", workspaceId: "nonexistent" });

		assert.deepEqual(runtime.calls, []);
		assert.deepEqual(caddy.calls, []);
	});

	it("handles stop job: cascades port cleanup via workspace route removal", async () => {
		const ws = await createWorkspace(db, { name: "proc-stop-ports", image: "alpine-v1" });
		await addPort(db, { workspaceId: ws.id, port: 3000 });
		await addPort(db, { workspaceId: ws.id, port: 5000 });

		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const processor = createProcessor({ db, runtime, caddy, logger, healthCheck: noopHealthCheck });

		await processor.process({ type: "stop", workspaceId: ws.id });

		assert.deepEqual(caddy.calls, ["removeRoute:proc-stop-ports"]);

		const remainingPorts = await listPorts(db, ws.id);
		assert.deepEqual(remainingPorts, []);
	});

	it("handles delete job: cascades port cleanup via workspace route removal", async () => {
		const ws = await createWorkspace(db, { name: "proc-del-ports", image: "alpine-v1" });
		await addPort(db, { workspaceId: ws.id, port: 4000 });

		const runtime = createMockRuntime();
		const caddy = createMockCaddy();
		const processor = createProcessor({ db, runtime, caddy, logger, healthCheck: noopHealthCheck });

		await processor.process({ type: "delete", workspaceId: ws.id });

		assert.deepEqual(caddy.calls, ["removeRoute:proc-del-ports"]);

		const deleted = await getWorkspace(db, ws.id);
		assert.equal(deleted, undefined);
	});
});
