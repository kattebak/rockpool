import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
	CreateTableCommand,
	type CreateTableCommandInput,
	DynamoDBClient,
	ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import DynamoDbLocal from "dynamodb-local";

import find from "find-process";

const MAX_CONNECT_RETRIES = 30;

export const createTable = async ({
	client,
	tableName,
	tableSchema,
}: {
	client: DynamoDBClient;
	tableName: string;
	tableSchema: CreateTableCommandInput;
}) => {
	const { TableNames } = await client.send(new ListTablesCommand());

	if (TableNames?.includes(tableName)) {
		console.log(`Table ${tableName} already exists`);
		return;
	}

	tableSchema.TableName = tableName;
	await client.send(new CreateTableCommand(tableSchema));
	console.log(`Table ${tableName} created`);
};

const start = async (params: {
	port: number;
	tableName: string;
	tableSchema?: CreateTableCommandInput;
}) => {
	const { port, tableSchema, tableName } = params;
	const [pid] = await find("name", "DynamoDBLocal.jar");

	if (!pid) {
		console.log(`starting DynamoDB Local on port ${port}`);
		await DynamoDbLocal.launch(
			port,
			null,
			["-inMemory", "-sharedDb"],
			true,
			true,
		);
	} else {
		console.log(`DynamoDB local already running on ${port}`);
	}

	const endpoint = `http://localhost:${port}`;

	const client = new DynamoDBClient({
		credentials: {
			accessKeyId: "fakeKey",
			secretAccessKey: "fakeSecretKey",
		},
		region: "local",
		endpoint,
	});

	let tries = 0;

	console.log("Verifying connection");
	do {
		const success = await client
			.send(new ListTablesCommand())
			.catch(() => false);

		if (success) break;

		console.log(`Connection failed, retrying ${tries++}...`);
		await new Promise((resolve) => setTimeout(resolve, 200));
	} while (tries < MAX_CONNECT_RETRIES);

	if (tableSchema)
		await createTable({
			client,
			tableSchema,
			tableName,
		});

	console.log("connection OK");
	process.exit(0);
};

const stop = async (port: number) => {
	if (process.env.GITHUB_ACTIONS) {
		console.log("Running on GitHub Actions, not stopping DynamoDB Local");
		return;
	}

	const list = await find("name", "DynamoDBLocal.jar");

	if (list.length === 0) {
		console.log(`DynamoDB Local not running on port ${port}`);
		return;
	}

	for (const { pid } of list) {
		console.log(`Killing process ${pid}`);
		process.kill(pid);
	}
};

const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	options: {
		port: {
			type: "string",
			default: process.env.DYNAMODB_PORT,
			short: "p",
		},
		schema: {
			type: "string",
			short: "s",
		},
		tableName: {
			type: "string",
			short: "t",
			default: process.env.DYNAMODB_TABLE_NAME,
		},
	},
	strict: false,
});

const [command] = positionals;
const { port, schema, tableName } = values as Record<string, string>;

switch (command) {
	case "stop":
		stop(parseInt(port, 10));
		break;
	default: {
		if (schema) {
			console.log(`Using schema ${schema}, table name ${tableName}`);
		}

		const tableSchema = schema
			? (JSON.parse(readFileSync(schema, "utf8")) as CreateTableCommandInput)
			: undefined;

		start({ port: parseInt(port, 10), tableSchema, tableName });
	}
}
