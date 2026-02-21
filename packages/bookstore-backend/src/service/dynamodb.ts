import { createClient } from "@bookstore/ddb-service";
import { env } from "expect-env";

let client: ReturnType<typeof createClient>;

export const getClient = () => {
	if (!client) {
		client = createClient({
			tableName: env.DYNAMODB_TABLE_NAME,
			nodeEnv: env.NODE_ENV,
			port: process.env.DYNAMODB_PORT,
			salt: env.DYNAMODB_PAGINATION_SALT,
		});
	}

	return client;
};
