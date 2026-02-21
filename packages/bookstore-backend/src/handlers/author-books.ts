import type { OperationHandler, OperationHandlerResponse } from "@bookstore/bookstore-types";
import { getClient } from "../service/dynamodb.js";
import type { AuthorBooksOperationIds } from "../types.js";

export const AuthorBooksOperations: Record<
	AuthorBooksOperationIds,
	OperationHandler<AuthorBooksOperationIds>
> = {
	AuthorBooksOperations_listAuthorBooks: async (
		context,
	): Promise<OperationHandlerResponse<"AuthorBooksOperations_listAuthorBooks">> =>
		getClient().author.listBooks(
			context.request.params.authorId,
			context.request.query,
		),
};
