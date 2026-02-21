import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

export interface DBClientTestContext {
	client: DynamoDBClient;
	tableName: string;
}

export type CleanupHook = () => Promise<unknown> | undefined;

const getEnv = (key: string): string => {
	const value = process.env[key];
	if (!value) throw new Error(`Missing required environment variable: ${key}`);
	return value;
};

export const setupDBClient = async (): Promise<DBClientTestContext> => {
	const port = getEnv("DYNAMODB_PORT");
	const tableName = getEnv("DYNAMODB_TABLE_NAME");
	const endpoint = `http://localhost:${port}`;

	console.debug(`Running tests against ${tableName} on ${endpoint}`);

	const client = new DynamoDBClient({
		endpoint,
		credentials: {
			accessKeyId: "fakeKey",
			secretAccessKey: "fakeSecretAccessKey",
		},
		region: "local",
	});

	return { client, tableName };
};

export const runCleanup = (cleanup: CleanupHook[]) => async () => {
	const todo = cleanup.splice(0, cleanup.length).reverse();
	const errors: Error[] = [];
	for (const fn of todo) {
		const result = fn();
		if (result && typeof result.then === "function") {
			await result.catch((err) => {
				console.error("Error during cleanup:", err);
				errors.push(err);
			});
		}
	}
	if (errors.length > 0) {
		throw new Error(`Cleanup failed with ${errors.length} error(s)`);
	}
};
