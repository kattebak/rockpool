import { createHash } from "node:crypto";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity, type Schema } from "electrodb";

export type ResultList<T> = {
	items: T[];
	continuationToken: string | undefined;
};

export abstract class BaseModel {
	constructor(
		protected client: DynamoDBDocumentClient,
		protected table: string,
		protected salt: string = "",
	) {}

	protected getEntity<T extends Schema<string, string, string>>(schema: T) {
		const { client, table } = this;
		return new Entity(schema, {
			client,
			table,
		});
	}

	protected createContinuationToken(cursor: string | null): string | undefined {
		if (!cursor) return undefined;

		const cursorString = Buffer.from(cursor, "base64url").toString("utf8");

		const hash = createHash("md5");
		hash.update(`${cursorString}#${this.salt}`);
		const digest = hash.digest("base64");

		return Buffer.from(
			JSON.stringify({ cursor: JSON.parse(cursorString), digest }),
			"utf8",
		).toString("base64url");
	}

	protected resultList<T>(items: T[], cursor: string | null): ResultList<T> {
		return { items, continuationToken: this.createContinuationToken(cursor) };
	}

	protected extractContinuationToken(nextToken?: string): string | undefined {
		if (!nextToken) return undefined;

		try {
			const buf = Buffer.from(nextToken, "base64url");
			const { cursor, digest } = JSON.parse(buf.toString("utf8"));
			const cursorString = JSON.stringify(cursor);

			const hash = createHash("md5");
			hash.update(`${cursorString}#${this.salt}`);
			const expected = hash.digest("base64");

			if (expected !== digest) {
				throw new NotFoundError(`Invalid next token: ${nextToken}`);
			}

			return Buffer.from(cursorString, "utf8").toString("base64url");
		} catch (_err) {
			throw new ClientError(`Invalid next token: ${nextToken}`);
		}
	}
}

export class HTTPError extends Error {
	public statusCode = 500;
}

export class BadRequestError extends HTTPError {
	name = "BadRequestError";
	public statusCode = 400;
}

export class ClientError extends HTTPError {
	name = "ClientError";
	public statusCode = 401;
}

export class NotFoundError extends HTTPError {
	name = "NotFoundError";
	public statusCode = 404;
}

export class ConflictError extends HTTPError {
	name = "ConflictError";
	public statusCode = 409;
}

export class CreateFailedConflictError extends ConflictError {
	public statusCode = 409;
	name = "CreateFailedConflictError";
	constructor(resourceType: string, params: unknown) {
		super(
			`${resourceType} with properties "${JSON.stringify(params)}" already exists.`,
		);
	}
}

export class UnhandledError extends HTTPError {
	name = "UnhandledError";
	public statusCode = 500;
	readonly cause: Error | undefined;

	constructor(message: string, cause?: Error) {
		super(message);
		this.message = message;
		if (cause) this.cause = cause;
	}

	toJSON() {
		return {
			message: this.message,
			cause: this.cause?.message,
			stack: this.cause?.stack || this.stack,
		};
	}
}

export class InternalServerError extends UnhandledError {
	name = "InternalServerError";
	public statusCode = 500;
}

export const handleCreateFailed = (resource: string, params: unknown) => {
	// biome-ignore lint/suspicious/noExplicitAny: Errors are never typed
	return (err: any) => {
		if (/ConditionalCheckFailedException/.test(err.cause)) {
			return Promise.reject(new CreateFailedConflictError(resource, params));
		}

		return Promise.reject(
			new UnhandledError(`Failed to create ${resource}`, err),
		);
	};
};
