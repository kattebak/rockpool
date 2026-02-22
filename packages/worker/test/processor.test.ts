import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TeardownMode, WorkspaceService } from "@rockpool/workspace-service";
import pino from "pino";
import { createProcessor } from "../src/processor.ts";

const logger = pino({ level: "silent" });

function createMockWorkspaceService(): WorkspaceService & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async list() {
			return { items: [] };
		},
		async get() {
			return undefined;
		},
		async create() {
			return {} as Awaited<ReturnType<WorkspaceService["create"]>>;
		},
		async start() {
			return {} as Awaited<ReturnType<WorkspaceService["start"]>>;
		},
		async stop() {
			return {} as Awaited<ReturnType<WorkspaceService["stop"]>>;
		},
		async remove() {},
		async provisionAndStart(id: string) {
			calls.push(`provisionAndStart:${id}`);
		},
		async teardown(id: string, mode: TeardownMode) {
			calls.push(`teardown:${id}:${mode}`);
		},
		async setError(id: string, message: string) {
			calls.push(`setError:${id}:${message}`);
		},
	};
}

describe("Processor", () => {
	it("dispatches create job to provisionAndStart", async () => {
		const workspaceService = createMockWorkspaceService();
		const processor = createProcessor({ workspaceService, logger });

		await processor.process({ type: "create", workspaceId: "ws-1" });

		assert.deepEqual(workspaceService.calls, ["provisionAndStart:ws-1"]);
	});

	it("dispatches start job to provisionAndStart", async () => {
		const workspaceService = createMockWorkspaceService();
		const processor = createProcessor({ workspaceService, logger });

		await processor.process({ type: "start", workspaceId: "ws-2" });

		assert.deepEqual(workspaceService.calls, ["provisionAndStart:ws-2"]);
	});

	it("dispatches stop job to teardown with stop mode", async () => {
		const workspaceService = createMockWorkspaceService();
		const processor = createProcessor({ workspaceService, logger });

		await processor.process({ type: "stop", workspaceId: "ws-3" });

		assert.deepEqual(workspaceService.calls, ["teardown:ws-3:stop"]);
	});

	it("dispatches delete job to teardown with delete mode", async () => {
		const workspaceService = createMockWorkspaceService();
		const processor = createProcessor({ workspaceService, logger });

		await processor.process({ type: "delete", workspaceId: "ws-4" });

		assert.deepEqual(workspaceService.calls, ["teardown:ws-4:delete"]);
	});

	it("calls setError when provisionAndStart throws", async () => {
		const workspaceService = createMockWorkspaceService();
		workspaceService.provisionAndStart = async () => {
			throw new Error("VM creation failed");
		};
		const processor = createProcessor({ workspaceService, logger });

		await processor.process({ type: "create", workspaceId: "ws-5" });

		assert.deepEqual(workspaceService.calls, ["setError:ws-5:VM creation failed"]);
	});

	it("calls setError when teardown throws", async () => {
		const workspaceService = createMockWorkspaceService();
		workspaceService.teardown = async () => {
			throw new Error("Stop failed");
		};
		const processor = createProcessor({ workspaceService, logger });

		await processor.process({ type: "stop", workspaceId: "ws-6" });

		assert.deepEqual(workspaceService.calls, ["setError:ws-6:Stop failed"]);
	});

	it("converts non-Error exceptions to string in setError", async () => {
		const workspaceService = createMockWorkspaceService();
		workspaceService.provisionAndStart = async () => {
			throw "unexpected string error";
		};
		const processor = createProcessor({ workspaceService, logger });

		await processor.process({ type: "start", workspaceId: "ws-7" });

		assert.deepEqual(workspaceService.calls, ["setError:ws-7:unexpected string error"]);
	});
});
