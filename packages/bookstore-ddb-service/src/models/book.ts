import type { Components, Operations } from "@bookstore/bookstore-types";
import { Author as AuthorSchema, Book as BookSchema } from "@bookstore/ddb-entities";
import { Service } from "electrodb";
import { BadRequestError, BaseModel, NotFoundError, handleCreateFailed } from "./base.js";

type Book = Components.Schemas.Book;
type BookWithAuthor = Components.Schemas.BookWithAuthor;
type BookCreateParams = Components.Schemas.BookCreateParams;
type BookUpdateParams = Components.Schemas.BookUpdateParams;
type BookStatus = Components.Schemas.BookStatus;
type BookGenre = Components.Schemas.BookGenre;
type DescribeBookResponse = Components.Schemas.DescribeBookResponse;
type ListBooksResponse = Operations["BookOperations_listBooks"]["response"];

export class BookOperations extends BaseModel {
	get book() {
		return this.getEntity(BookSchema);
	}

	get author() {
		return this.getEntity(AuthorSchema);
	}

	get bookService() {
		return new Service({
			books: this.book,
			authors: this.author,
		});
	}

	async get(bookId: string): Promise<Book> {
		const { data: book } = await this.book.get({ bookId }).go();

		if (!book) return Promise.reject(new NotFoundError());
		return book as Book;
	}

	async list(
		params: {
			continuationToken?: string;
			count?: number;
			status?: BookStatus;
			genre?: BookGenre;
		} = {},
	): Promise<ListBooksResponse> {
		const { continuationToken, count, status, genre } = params;
		const cursor = this.extractContinuationToken(continuationToken);

		let data: unknown[];
		let nextCursor: string | null;

		if (status) {
			const result = await this.book.query
				.byStatus({ status })
				.go({ cursor, limit: count });
			data = result.data;
			nextCursor = result.cursor;
		} else if (genre) {
			const result = await this.book.query
				.byGenre({ genre })
				.go({ cursor, limit: count });
			data = result.data;
			nextCursor = result.cursor;
		} else {
			const result = await this.book.query
				.byStatus({ status: "Published" })
				.go({ cursor, limit: count });
			data = result.data;
			nextCursor = result.cursor;
		}

		const booksWithAuthor = await Promise.all(
			data.map(async (book) => {
				const bookData = book as Book;
				const author = await this.getAuthorSafe(bookData.authorId);
				return { ...bookData, author } as BookWithAuthor;
			}),
		);

		return this.resultList(booksWithAuthor, nextCursor);
	}

	async describe(bookId: string): Promise<DescribeBookResponse> {
		const {
			data: { books },
		} = await this.bookService.collections
			.book({ bookId })
			.go({ pages: "all" });

		if (!books || books.length === 0) {
			return Promise.reject(new NotFoundError());
		}

		const book = books[0] as Book;
		const author = await this.author.get({ authorId: book.authorId }).go();

		if (!author.data) {
			return Promise.reject(new NotFoundError(`Author not found for book ${bookId}`));
		}

		return {
			book,
			author: author.data,
		} as DescribeBookResponse;
	}

	async create(
		bookId: string,
		data: BookCreateParams,
	): Promise<Book> {
		const author = await this.author.get({ authorId: data.authorId }).go();
		if (!author.data) {
			return Promise.reject(new BadRequestError(`Author ${data.authorId} not found`));
		}

		const { data: book } = await this.book
			.create({
				bookId,
				...data,
				status: data.status ?? "Draft",
			})
			.go()
			.catch(handleCreateFailed("Book", { bookId }));

		return book as Book;
	}

	async update(
		bookId: string,
		data: BookUpdateParams,
	): Promise<Book> {
		const existingBook = await this.get(bookId);

		const { data: book } = await this.book
			.patch({ bookId })
			.set({
				description: data.description ?? existingBook.description,
				genre: data.genre ?? existingBook.genre,
				status: data.status ?? existingBook.status,
				price: data.price ?? existingBook.price,
				pageCount: data.pageCount ?? existingBook.pageCount,
				publishedAt: data.publishedAt ?? existingBook.publishedAt,
				coverImageUrl: data.coverImageUrl ?? existingBook.coverImageUrl,
			})
			.go({ response: "all_new" });

		return book as Book;
	}

	async delete(bookId: string): Promise<void> {
		await this.book.delete({ bookId }).go();
	}

	async publish(bookId: string): Promise<Book> {
		const existingBook = await this.get(bookId);

		if (existingBook.status === "Published") {
			return existingBook;
		}

		const { data: book } = await this.book
			.patch({ bookId })
			.set({
				status: "Published",
				publishedAt: Date.now(),
			})
			.go({ response: "all_new" });

		return book as Book;
	}

	async unpublish(bookId: string): Promise<Book> {
		const existingBook = await this.get(bookId);

		if (existingBook.status !== "Published") {
			return existingBook;
		}

		const { data: book } = await this.book
			.patch({ bookId })
			.set({
				status: "Draft",
			})
			.go({ response: "all_new" });

		return book as Book;
	}

	private async getAuthorSafe(authorId: string) {
		const { data: author } = await this.author.get({ authorId }).go();
		return author ?? undefined;
	}
}
