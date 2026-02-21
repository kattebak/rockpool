import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import assert from "node:assert";
import { AuthorOperations } from "./author.js";
import { BookOperations } from "./book.js";
import { type CleanupHook, runCleanup, setupDBClient } from "./test-fixtures.js";

const generateAuthorId = () => `aut_${randomBytes(10).toString("hex")}`;
const generateBookId = () => `bok_${randomBytes(10).toString("hex")}`;

describe("BookOperations", async () => {
	const { client, tableName } = await setupDBClient();
	const cleanup: CleanupHook[] = [];

	after(runCleanup(cleanup));

	const authorOps = new AuthorOperations(client, tableName, "test-salt");
	const bookOps = new BookOperations(client, tableName, "test-salt");

	let testAuthorId: string;

	before(async () => {
		testAuthorId = generateAuthorId();
		await authorOps.create(testAuthorId, { name: "Test Author" });
		cleanup.push(() => authorOps.delete(testAuthorId));
	});

	describe("create", () => {
		it("creates a book with required fields", async () => {
			const bookId = generateBookId();
			cleanup.push(() => bookOps.delete(bookId));

			const book = await bookOps.create(bookId, {
				authorId: testAuthorId,
				title: "My First Book",
			});

			assert.strictEqual(book.bookId, bookId);
			assert.strictEqual(book.authorId, testAuthorId);
			assert.strictEqual(book.title, "My First Book");
			assert.strictEqual(book.status, "Draft");
			assert.ok(book.createdAt);
			assert.ok(book.updatedAt);
		});

		it("creates a book with all fields", async () => {
			const bookId = generateBookId();
			cleanup.push(() => bookOps.delete(bookId));

			const book = await bookOps.create(bookId, {
				authorId: testAuthorId,
				title: "Complete Book",
				isbn: "1234567890",
				description: "A great book",
				genre: "Fiction",
				status: "Draft",
				price: 1999,
				pageCount: 300,
				coverImageUrl: "https://example.com/cover.jpg",
			});

			assert.strictEqual(book.title, "Complete Book");
			assert.strictEqual(book.isbn, "1234567890");
			assert.strictEqual(book.genre, "Fiction");
			assert.strictEqual(book.price, 1999);
			assert.strictEqual(book.pageCount, 300);
		});

		it("rejects creation with non-existent author", async () => {
			const bookId = generateBookId();

			await assert.rejects(
				() => bookOps.create(bookId, {
					authorId: "non-existent-author",
					title: "Orphan Book",
				}),
				{ name: "BadRequestError" },
			);
		});
	});

	describe("get", () => {
		it("retrieves an existing book", async () => {
			const bookId = generateBookId();
			cleanup.push(() => bookOps.delete(bookId));

			await bookOps.create(bookId, {
				authorId: testAuthorId,
				title: "Retrievable Book",
			});

			const book = await bookOps.get(bookId);

			assert.strictEqual(book.bookId, bookId);
			assert.strictEqual(book.title, "Retrievable Book");
		});

		it("throws NotFoundError for non-existent book", async () => {
			await assert.rejects(
				() => bookOps.get("non-existent-id"),
				{ name: "NotFoundError" },
			);
		});
	});

	describe("describe", () => {
		it("returns book with author details", async () => {
			const bookId = generateBookId();
			cleanup.push(() => bookOps.delete(bookId));

			await bookOps.create(bookId, {
				authorId: testAuthorId,
				title: "Book With Author",
			});

			const result = await bookOps.describe(bookId);

			assert.strictEqual(result.book.bookId, bookId);
			assert.strictEqual(result.author.authorId, testAuthorId);
			assert.strictEqual(result.author.name, "Test Author");
		});
	});

	describe("publish/unpublish", () => {
		it("publishes a draft book", async () => {
			const bookId = generateBookId();
			cleanup.push(() => bookOps.delete(bookId));

			await bookOps.create(bookId, {
				authorId: testAuthorId,
				title: "To Publish",
			});

			const published = await bookOps.publish(bookId);

			assert.strictEqual(published.status, "Published");
			assert.ok(published.publishedAt);
		});

		it("unpublishes a published book", async () => {
			const bookId = generateBookId();
			cleanup.push(() => bookOps.delete(bookId));

			await bookOps.create(bookId, {
				authorId: testAuthorId,
				title: "To Unpublish",
			});
			await bookOps.publish(bookId);

			const unpublished = await bookOps.unpublish(bookId);

			assert.strictEqual(unpublished.status, "Draft");
		});
	});

	describe("update", () => {
		it("updates book fields", async () => {
			const bookId = generateBookId();
			cleanup.push(() => bookOps.delete(bookId));

			await bookOps.create(bookId, {
				authorId: testAuthorId,
				title: "Original Title",
			});

			const updated = await bookOps.update(bookId, {
				description: "Updated description",
				price: 2499,
			});

			assert.strictEqual(updated.description, "Updated description");
			assert.strictEqual(updated.price, 2499);
		});
	});

	describe("delete", () => {
		it("deletes a book", async () => {
			const bookId = generateBookId();
			await bookOps.create(bookId, {
				authorId: testAuthorId,
				title: "To Delete",
			});

			await bookOps.delete(bookId);

			await assert.rejects(
				() => bookOps.get(bookId),
				{ name: "NotFoundError" },
			);
		});
	});
});
