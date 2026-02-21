import type { OperationHandler, OperationHandlerResponse } from "@bookstore/bookstore-types";
import { getClient } from "../service/dynamodb.js";
import { generateId } from "../service/uuid.js";
import type { AuthorOperationIds } from "../types.js";

export const AuthorOperations: Record<
	AuthorOperationIds,
	OperationHandler<AuthorOperationIds>
> = {
	AuthorOperations_listAuthors: async (
		context,
	): Promise<OperationHandlerResponse<"AuthorOperations_listAuthors">> =>
		getClient().author.list(context.request.query),

	AuthorOperations_createAuthor: async (
		context,
	): Promise<OperationHandlerResponse<"AuthorOperations_createAuthor">> =>
		getClient().author.create(generateId(), context.request.requestBody),
};
