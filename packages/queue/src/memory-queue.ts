import { randomUUID } from "node:crypto";
import type { QueueRepository, ReceivedJob, WorkspaceJob } from "./types.ts";

interface QueuedMessage {
	id: string;
	body: WorkspaceJob;
}

export function createMemoryQueue(): QueueRepository {
	const messages: QueuedMessage[] = [];

	return {
		async send(job: WorkspaceJob): Promise<void> {
			messages.push({ id: randomUUID(), body: job });
		},

		async receive(): Promise<ReceivedJob | null> {
			const message = messages.shift();
			if (!message) {
				return null;
			}
			return { job: message.body, receiptHandle: message.id };
		},

		async delete(_receiptHandle: string): Promise<void> {
			// In the memory implementation, the message is already removed by receive()
		},
	};
}
