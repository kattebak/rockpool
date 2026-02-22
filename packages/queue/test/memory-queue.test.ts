import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryQueue } from "../src/memory-queue.ts";

describe("MemoryQueue", () => {
	it("receive returns null when queue is empty", async () => {
		const queue = createMemoryQueue();
		const result = await queue.receive();
		assert.equal(result, null);
	});

	it("send and receive a job", async () => {
		const queue = createMemoryQueue();
		await queue.send({ type: "create", workspaceId: "ws-1" });

		const result = await queue.receive();
		assert.notEqual(result, null);
		assert.deepEqual(result?.job, { type: "create", workspaceId: "ws-1" });
		assert.equal(typeof result?.receiptHandle, "string");
	});

	it("messages are consumed in FIFO order", async () => {
		const queue = createMemoryQueue();
		await queue.send({ type: "create", workspaceId: "ws-1" });
		await queue.send({ type: "start", workspaceId: "ws-2" });
		await queue.send({ type: "stop", workspaceId: "ws-3" });

		const first = await queue.receive();
		const second = await queue.receive();
		const third = await queue.receive();

		assert.equal(first?.job.workspaceId, "ws-1");
		assert.equal(second?.job.workspaceId, "ws-2");
		assert.equal(third?.job.workspaceId, "ws-3");
	});

	it("receive returns null after all messages are consumed", async () => {
		const queue = createMemoryQueue();
		await queue.send({ type: "delete", workspaceId: "ws-1" });

		await queue.receive();
		const result = await queue.receive();
		assert.equal(result, null);
	});

	it("delete does not throw", async () => {
		const queue = createMemoryQueue();
		await queue.delete("any-handle");
	});
});
