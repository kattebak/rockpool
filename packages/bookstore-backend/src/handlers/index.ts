import type { OperationHandler } from "@bookstore/bookstore-types";
import type { OperationIds } from "../types.js";
import { AuthorOperations } from "./author.js";
import { AuthorBooksOperations } from "./author-books.js";
import { AuthorDetailOperations } from "./author-detail.js";
import { BookOperations } from "./book.js";
import { BookDetailOperations } from "./book-detail.js";
import { SearchOperations } from "./search.js";

// biome-ignore lint/suspicious/noExplicitAny: Types are narrowed downstream
export const handlers: Record<OperationIds, OperationHandler<any>> = {
	...AuthorOperations,
	...AuthorBooksOperations,
	...AuthorDetailOperations,
	...BookOperations,
	...BookDetailOperations,
	...SearchOperations,
};
