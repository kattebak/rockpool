import {
	DeleteMessageCommand,
	ReceiveMessageCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import type { QueueOptions, QueueRepository, ReceivedJob, WorkspaceJob } from "./types.ts";

const DEFAULT_REGION = "us-east-1";
const DEFAULT_WAIT_TIME_SECONDS = 20;

export function createSqsQueue(options: QueueOptions): QueueRepository {
	const client = new SQSClient({
		endpoint: options.endpoint,
		region: options.region ?? DEFAULT_REGION,
		credentials: {
			accessKeyId: "local",
			secretAccessKey: "local",
		},
	});

	const queueUrl = options.queueUrl;
	const waitTimeSeconds = options.waitTimeSeconds ?? DEFAULT_WAIT_TIME_SECONDS;

	return {
		async send(job: WorkspaceJob): Promise<void> {
			await client.send(
				new SendMessageCommand({
					QueueUrl: queueUrl,
					MessageBody: JSON.stringify(job),
				}),
			);
		},

		async receive(): Promise<ReceivedJob | null> {
			const result = await client.send(
				new ReceiveMessageCommand({
					QueueUrl: queueUrl,
					MaxNumberOfMessages: 1,
					WaitTimeSeconds: waitTimeSeconds,
				}),
			);

			const message = result.Messages?.[0];
			if (!message?.Body || !message.ReceiptHandle) {
				return null;
			}

			const job = JSON.parse(message.Body) as WorkspaceJob;
			return { job, receiptHandle: message.ReceiptHandle };
		},

		async delete(receiptHandle: string): Promise<void> {
			await client.send(
				new DeleteMessageCommand({
					QueueUrl: queueUrl,
					ReceiptHandle: receiptHandle,
				}),
			);
		},
	};
}
