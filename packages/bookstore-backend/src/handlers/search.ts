import type { OperationHandler, OperationHandlerResponse } from "@bookstore/bookstore-types";
import type { SearchOperationIds } from "../types.js";

export const SearchOperations: Record<
	SearchOperationIds,
	OperationHandler<SearchOperationIds>
> = {
	SearchOperations_searchAuthors: async (
		_context,
	): Promise<OperationHandlerResponse<"SearchOperations_searchAuthors">> => {
		return { items: [] };
	},

	SearchOperations_searchBooks: async (
		_context,
	): Promise<OperationHandlerResponse<"SearchOperations_searchBooks">> => {
		return { items: [] };
	},
};
