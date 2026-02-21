import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { AuthorOperations } from "./models/author.js";
import { BookOperations } from "./models/book.js";

export { AuthorOperations, BookOperations };

export * from "./models/base.js";

let client: DynamoDBClient;

export interface DBConfig {
	tableName: string;
	nodeEnv?: string;
	port?: string;
	salt: string;
}

export const createClient = (config: DBConfig) => {
	if (!client) {
		if (config.nodeEnv === "development") {
			const endpoint = `http://localhost:${config.port ?? 5125}`;
			client = new DynamoDBClient({
				endpoint,
				credentials: {
					accessKeyId: "fakeKey",
					secretAccessKey: "fakeSecretAccessKey",
				},
				region: "local",
			});
		} else {
			client = new DynamoDBClient();
		}
	}

	const tableName = config.tableName;
	const salt = config.salt;

	return {
		get _ddbClient() {
			return client;
		},
		get author() {
			return new AuthorOperations(client, tableName, salt);
		},
		get book() {
			return new BookOperations(client, tableName, salt);
		},
	};
};
