import type { QueueRepository } from "@tdpl/queue";
import type { Logger } from "pino";
import type { createProcessor } from "./processor.ts";

export interface PollLoopOptions {
	queue: QueueRepository;
	processor: ReturnType<typeof createProcessor>;
	logger: Logger;
}

export function createPollLoop(options: PollLoopOptions) {
	const { queue, processor, logger } = options;
	let running = false;

	async function poll(): Promise<void> {
		const received = await queue.receive();
		if (!received) {
			return;
		}

		logger.info(
			{ jobType: received.job.type, workspaceId: received.job.workspaceId },
			"Received job",
		);

		await processor.process(received.job);
		await queue.delete(received.receiptHandle);
	}

	return {
		async start(): Promise<void> {
			running = true;
			logger.info("Worker poll loop started");

			while (running) {
				try {
					await poll();
				} catch (err) {
					logger.error({ err }, "Poll loop error, retrying");
					await new Promise((resolve) => setTimeout(resolve, 5000));
				}
			}

			logger.info("Worker poll loop stopped");
		},

		stop(): void {
			running = false;
		},
	};
}
