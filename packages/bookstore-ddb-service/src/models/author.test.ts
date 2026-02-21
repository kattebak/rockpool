import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import assert from "node:assert";
import { AuthorOperations } from "./author.js";
import { type CleanupHook, runCleanup, setupDBClient } from "./test-fixtures.js";

const generateId = () => `aut_${randomBytes(10).toString("hex")}`;

describe("AuthorOperations", async () => {
	const { client, tableName } = await setupDBClient();
	const cleanup: CleanupHook[] = [];

	after(runCleanup(cleanup));

	const authorOps = new AuthorOperations(client, tableName, "test-salt");

	describe("create", () => {
		it("creates an author with required fields", async () => {
			const authorId = generateId();
			cleanup.push(() => authorOps.delete(authorId));

			const author = await authorOps.create(authorId, {
				name: "Jane Doe",
			});

			assert.strictEqual(author.authorId, authorId);
			assert.strictEqual(author.name, "Jane Doe");
			assert.ok(author.createdAt);
			assert.ok(author.updatedAt);
		});

		it("creates an author with all fields", async () => {
			const authorId = generateId();
			cleanup.push(() => authorOps.delete(authorId));

			const author = await authorOps.create(authorId, {
				name: "John Smith",
				biography: "A prolific author",
				email: "john@example.com",
				website: "https://johnsmith.com",
			});

			assert.strictEqual(author.name, "John Smith");
			assert.strictEqual(author.biography, "A prolific author");
			assert.strictEqual(author.email, "john@example.com");
			assert.strictEqual(author.website, "https://johnsmith.com");
		});
	});

	describe("get", () => {
		it("retrieves an existing author", async () => {
			const authorId = generateId();
			cleanup.push(() => authorOps.delete(authorId));

			await authorOps.create(authorId, { name: "Test Author" });
			const author = await authorOps.get(authorId);

			assert.strictEqual(author.authorId, authorId);
			assert.strictEqual(author.name, "Test Author");
		});

		it("throws NotFoundError for non-existent author", async () => {
			await assert.rejects(
				() => authorOps.get("non-existent-id"),
				{ name: "NotFoundError" },
			);
		});
	});

	describe("update", () => {
		it("updates author fields", async () => {
			const authorId = generateId();
			cleanup.push(() => authorOps.delete(authorId));

			await authorOps.create(authorId, { name: "Original Name" });

			const updated = await authorOps.update(authorId, {
				biography: "Updated biography",
			});

			assert.strictEqual(updated.biography, "Updated biography");
		});
	});

	describe("delete", () => {
		it("deletes an author", async () => {
			const authorId = generateId();
			await authorOps.create(authorId, { name: "To Delete" });
			await authorOps.delete(authorId);

			await assert.rejects(
				() => authorOps.get(authorId),
				{ name: "NotFoundError" },
			);
		});
	});

	describe("list", () => {
		it("lists authors with pagination", async () => {
			const authorIds = [generateId(), generateId()];
			for (const id of authorIds) {
				cleanup.push(() => authorOps.delete(id));
				await authorOps.create(id, { name: `Author ${id}` });
			}

			const result = await authorOps.list({ count: 10 });

			assert.ok(result.items.length >= 2);
			assert.ok(Array.isArray(result.items));
		});
	});
});
