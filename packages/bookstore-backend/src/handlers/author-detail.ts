import type { OperationHandler, OperationHandlerResponse } from "@bookstore/bookstore-types";
import { getClient } from "../service/dynamodb.js";
import type { AuthorDetailOperationIds } from "../types.js";

export const AuthorDetailOperations: Record<
	AuthorDetailOperationIds,
	OperationHandler<AuthorDetailOperationIds>
> = {
	AuthorDetailOperations_describeAuthor: async (
		context,
	): Promise<OperationHandlerResponse<"AuthorDetailOperations_describeAuthor">> =>
		getClient().author.describe(context.request.params.authorId),

	AuthorDetailOperations_updateAuthor: async (
		context,
	): Promise<OperationHandlerResponse<"AuthorDetailOperations_updateAuthor">> =>
		getClient().author.update(
			context.request.params.authorId,
			context.request.requestBody,
		),

	AuthorDetailOperations_deleteAuthor: async (
		context,
	): Promise<OperationHandlerResponse<"AuthorDetailOperations_deleteAuthor">> => {
		await getClient().author.delete(context.request.params.authorId);
		return { statusCode: 204 };
	},
};
