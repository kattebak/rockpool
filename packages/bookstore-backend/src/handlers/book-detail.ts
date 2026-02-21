import type { OperationHandler, OperationHandlerResponse } from "@bookstore/bookstore-types";
import { getClient } from "../service/dynamodb.js";
import type { BookDetailOperationIds } from "../types.js";

export const BookDetailOperations: Record<
	BookDetailOperationIds,
	OperationHandler<BookDetailOperationIds>
> = {
	BookDetailOperations_describeBook: async (
		context,
	): Promise<OperationHandlerResponse<"BookDetailOperations_describeBook">> =>
		getClient().book.describe(context.request.params.bookId),

	BookDetailOperations_updateBook: async (
		context,
	): Promise<OperationHandlerResponse<"BookDetailOperations_updateBook">> =>
		getClient().book.update(
			context.request.params.bookId,
			context.request.requestBody,
		),

	BookDetailOperations_deleteBook: async (
		context,
	): Promise<OperationHandlerResponse<"BookDetailOperations_deleteBook">> => {
		await getClient().book.delete(context.request.params.bookId);
		return { statusCode: 204 };
	},

	BookDetailOperations_publishBook: async (
		context,
	): Promise<OperationHandlerResponse<"BookDetailOperations_publishBook">> =>
		getClient().book.publish(context.request.params.bookId),

	BookDetailOperations_unpublishBook: async (
		context,
	): Promise<OperationHandlerResponse<"BookDetailOperations_unpublishBook">> =>
		getClient().book.unpublish(context.request.params.bookId),
};
