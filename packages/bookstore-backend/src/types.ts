import type { Operations } from "@bookstore/bookstore-types";

type MatchPrefix<
	Prefix extends string,
	S extends string,
> = S extends `${Prefix}${infer _}` ? S : never;

export type OperationIds = keyof Operations;

export type AuthorOperationIds = MatchPrefix<"AuthorOperations_", OperationIds>;

export type AuthorDetailOperationIds = MatchPrefix<
	"AuthorDetailOperations_",
	OperationIds
>;

export type AuthorBooksOperationIds = MatchPrefix<
	"AuthorBooksOperations_",
	OperationIds
>;

export type BookOperationIds = MatchPrefix<"BookOperations_", OperationIds>;

export type BookDetailOperationIds = MatchPrefix<
	"BookDetailOperations_",
	OperationIds
>;

export type SearchOperationIds = MatchPrefix<"SearchOperations_", OperationIds>;
