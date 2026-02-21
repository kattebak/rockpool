import type { OperationHandler, OperationHandlerResponse } from "@bookstore/bookstore-types";
import { getClient } from "../service/dynamodb.js";
import { generateId } from "../service/uuid.js";
import type { BookOperationIds } from "../types.js";

export const BookOperations: Record<
	BookOperationIds,
	OperationHandler<BookOperationIds>
> = {
	BookOperations_listBooks: async (
		context,
	): Promise<OperationHandlerResponse<"BookOperations_listBooks">> =>
		getClient().book.list(context.request.query),

	BookOperations_createBook: async (
		context,
	): Promise<OperationHandlerResponse<"BookOperations_createBook">> =>
		getClient().book.create(generateId(), context.request.requestBody),
};
