export type JobType = "create" | "start" | "stop" | "delete";

export interface WorkspaceJob {
	type: JobType;
	workspaceId: string;
}

export interface ReceivedJob {
	job: WorkspaceJob;
	receiptHandle: string;
}

export interface QueueRepository {
	send(job: WorkspaceJob): Promise<void>;
	receive(): Promise<ReceivedJob | null>;
	delete(receiptHandle: string): Promise<void>;
}

export interface QueueOptions {
	endpoint: string;
	queueUrl: string;
	region?: string;
	waitTimeSeconds?: number;
}
