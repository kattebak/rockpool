import type { Components, Operations } from "@bookstore/bookstore-types";
import { Author as AuthorSchema, Book as BookSchema } from "@bookstore/ddb-entities";
import { Service } from "electrodb";
import { BaseModel, NotFoundError, handleCreateFailed } from "./base.js";

type Author = Components.Schemas.Author;
type AuthorWithBookCount = Components.Schemas.AuthorWithBookCount;
type AuthorCreateParams = Components.Schemas.AuthorCreateParams;
type AuthorUpdateParams = Components.Schemas.AuthorUpdateParams;
type ListAuthorsResponse = Operations["AuthorOperations_listAuthors"]["response"];
type DescribeAuthorResponse = Operations["AuthorDetailOperations_describeAuthor"]["response"];
type ListAuthorBooksResponse = Operations["AuthorBooksOperations_listAuthorBooks"]["response"];

export class AuthorOperations extends BaseModel {
	get author() {
		return this.getEntity(AuthorSchema);
	}

	get book() {
		return this.getEntity(BookSchema);
	}

	get authorService() {
		return new Service({
			authors: this.author,
			books: this.book,
		});
	}

	async get(authorId: string): Promise<Author> {
		const { data: author } = await this.author.get({ authorId }).go();

		if (!author) return Promise.reject(new NotFoundError());
		return author as Author;
	}

	async list(
		params: { continuationToken?: string; count?: number } = {},
	): Promise<ListAuthorsResponse> {
		const { continuationToken, count } = params;
		const cursor = this.extractContinuationToken(continuationToken);

		const { data, cursor: nextCursor } = await this.author.query
			.byName({})
			.go({ cursor, limit: count });

		const authorsWithBookCount = await Promise.all(
			data.map(async (author) => {
				const bookCount = await this.countBooks(author.authorId);
				return { ...author, bookCount } as AuthorWithBookCount;
			}),
		);

		return this.resultList(authorsWithBookCount, nextCursor);
	}

	async describe(authorId: string): Promise<DescribeAuthorResponse> {
		const {
			data: { authors, books },
		} = await this.authorService.collections
			.author({ authorId })
			.go({ pages: "all" });

		if (!authors || authors.length === 0) {
			return Promise.reject(new NotFoundError());
		}

		return {
			...authors[0],
			bookCount: books?.length ?? 0,
		} as AuthorWithBookCount;
	}

	async listBooks(
		authorId: string,
		params: { continuationToken?: string; count?: number } = {},
	): Promise<ListAuthorBooksResponse> {
		const { continuationToken, count } = params;
		const cursor = this.extractContinuationToken(continuationToken);

		const { data, cursor: nextCursor } = await this.book.query
			.byAuthor({ authorId })
			.go({ cursor, limit: count });

		return this.resultList(data, nextCursor);
	}

	async create(
		authorId: string,
		data: AuthorCreateParams,
	): Promise<Author> {
		const { data: author } = await this.author
			.create({ authorId, ...data })
			.go()
			.catch(handleCreateFailed("Author", { authorId }));

		return author as Author;
	}

	async update(
		authorId: string,
		data: AuthorUpdateParams,
	): Promise<Author> {
		const existingAuthor = await this.get(authorId);

		const { data: author } = await this.author
			.patch({ authorId })
			.set({
				biography: data.biography ?? existingAuthor.biography,
				email: data.email ?? existingAuthor.email,
				website: data.website ?? existingAuthor.website,
			})
			.go({ response: "all_new" });

		return author as Author;
	}

	async delete(authorId: string): Promise<void> {
		await this.author.delete({ authorId }).go();
	}

	private async countBooks(authorId: string): Promise<number> {
		const { data } = await this.book.query
			.byAuthor({ authorId })
			.go({ pages: "all" });
		return data.length;
	}
}
