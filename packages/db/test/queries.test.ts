import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { WorkspaceStatus as WS } from "@rockpool/enums";
import type { DbClient } from "../src/connection.ts";
import { createMemoryDb } from "../src/connection.ts";
import {
	addPort,
	countWorkspaces,
	countWorkspacesByStatus,
	createWorkspace,
	decodeCursor,
	deleteWorkspace,
	encodeCursor,
	getWorkspace,
	getWorkspaceByName,
	listPorts,
	listWorkspaces,
	removeAllPorts,
	removePort,
	updateWorkspaceStatus,
} from "../src/queries.ts";

describe("Workspace queries", () => {
	let db: DbClient;

	before(() => {
		db = createMemoryDb();
	});

	after(() => {
		// better-sqlite3 cleans up on GC for in-memory DBs
	});

	it("listWorkspaces returns empty items initially", async () => {
		const result = await listWorkspaces(db);
		assert.deepEqual(result.items, []);
		assert.equal(result.nextCursor, undefined);
	});

	it("createWorkspace inserts and returns a workspace", async () => {
		const ws = await createWorkspace(db, { name: "test-ws", image: "alpine-v1" });

		assert.equal(typeof ws.id, "string");
		assert.ok(ws.id.length > 0);
		assert.equal(ws.name, "test-ws");
		assert.equal(ws.image, "alpine-v1");
		assert.equal(ws.status, WS.creating);
		assert.equal(ws.vmIp, null);
		assert.equal(ws.errorMessage, null);
		assert.ok(ws.createdAt instanceof Date);
		assert.ok(ws.updatedAt instanceof Date);
	});

	it("getWorkspace retrieves by id", async () => {
		const created = await createWorkspace(db, { name: "get-by-id", image: "alpine-v1" });
		const found = await getWorkspace(db, created.id);

		assert.notEqual(found, undefined);
		assert.equal(found?.id, created.id);
		assert.equal(found?.name, "get-by-id");
	});

	it("getWorkspace returns undefined for missing id", async () => {
		const found = await getWorkspace(db, "nonexistent");
		assert.equal(found, undefined);
	});

	it("getWorkspaceByName retrieves by name", async () => {
		const created = await createWorkspace(db, {
			name: "get-by-name",
			image: "alpine-v1",
		});
		const found = await getWorkspaceByName(db, "get-by-name");

		assert.notEqual(found, undefined);
		assert.equal(found?.id, created.id);
	});

	it("updateWorkspaceStatus changes status and vmIp", async () => {
		const created = await createWorkspace(db, {
			name: "status-test",
			image: "alpine-v1",
		});

		const updated = await updateWorkspaceStatus(db, created.id, WS.running, {
			vmIp: "192.168.64.5",
		});

		assert.notEqual(updated, undefined);
		assert.equal(updated?.status, WS.running);
		assert.equal(updated?.vmIp, "192.168.64.5");
	});

	it("updateWorkspaceStatus sets error message", async () => {
		const created = await createWorkspace(db, {
			name: "error-test",
			image: "alpine-v1",
		});

		const updated = await updateWorkspaceStatus(db, created.id, WS.error, {
			errorMessage: "VM creation failed",
		});

		assert.notEqual(updated, undefined);
		assert.equal(updated?.status, WS.error);
		assert.equal(updated?.errorMessage, "VM creation failed");
	});

	it("deleteWorkspace removes the workspace", async () => {
		const created = await createWorkspace(db, {
			name: "delete-test",
			image: "alpine-v1",
		});

		await deleteWorkspace(db, created.id);
		const found = await getWorkspace(db, created.id);
		assert.equal(found, undefined);
	});

	it("listWorkspaces returns workspaces in paginated result", async () => {
		const result = await listWorkspaces(db);
		assert.ok(result.items.length > 0);
	});

	it("createWorkspace rejects duplicate names", async () => {
		await createWorkspace(db, { name: "unique-name", image: "alpine-v1" });
		await assert.rejects(() => createWorkspace(db, { name: "unique-name", image: "alpine-v1" }));
	});
});

describe("Cursor encoding", () => {
	it("encodeCursor and decodeCursor are inverse operations", () => {
		const date = new Date("2026-01-15T10:30:00Z");
		const id = "abc123";
		const cursor = encodeCursor(date, id);
		const decoded = decodeCursor(cursor);
		assert.equal(decoded.createdAt.getTime(), date.getTime());
		assert.equal(decoded.id, id);
	});

	it("encodeCursor produces a base64url string", () => {
		const cursor = encodeCursor(new Date(), "test-id");
		assert.ok(typeof cursor === "string");
		assert.ok(cursor.length > 0);
		assert.ok(/^[A-Za-z0-9_-]+$/.test(cursor));
	});

	it("decodeCursor throws on invalid cursor", () => {
		assert.throws(() => decodeCursor("not-valid-base64-cursor"));
	});
});

describe("Workspace pagination", () => {
	let db: DbClient;

	before(async () => {
		db = createMemoryDb();
		for (let i = 0; i < 5; i++) {
			await createWorkspace(db, { name: `page-ws-${i}`, image: "alpine-v1" });
		}
	});

	it("respects limit parameter", async () => {
		const result = await listWorkspaces(db, { limit: 2 });
		assert.equal(result.items.length, 2);
		assert.ok(result.nextCursor);
	});

	it("returns no nextCursor when all results fit", async () => {
		const result = await listWorkspaces(db, { limit: 100 });
		assert.equal(result.nextCursor, undefined);
	});

	it("returns results ordered by createdAt descending", async () => {
		const result = await listWorkspaces(db, { limit: 100 });
		for (let i = 1; i < result.items.length; i++) {
			assert.ok(result.items[i - 1].createdAt >= result.items[i].createdAt);
		}
	});

	it("paginates through all results using cursor", async () => {
		const allItems = [];
		let cursor: string | undefined;

		for (;;) {
			const result = await listWorkspaces(db, { limit: 2, cursor });
			allItems.push(...result.items);
			if (!result.nextCursor) break;
			cursor = result.nextCursor;
		}

		assert.equal(allItems.length, 5);
		const names = new Set(allItems.map((w) => w.name));
		assert.equal(names.size, 5);
	});

	it("defaults to limit 25 when no params provided", async () => {
		const result = await listWorkspaces(db);
		assert.ok(result.items.length <= 25);
		assert.equal(result.nextCursor, undefined);
	});
});

describe("Port queries", () => {
	let db: DbClient;

	before(() => {
		db = createMemoryDb();
	});

	it("listPorts returns empty array initially", async () => {
		const ws = await createWorkspace(db, { name: "port-list-empty", image: "alpine-v1" });
		const result = await listPorts(db, ws.id);
		assert.deepEqual(result, []);
	});

	it("addPort inserts and returns a port", async () => {
		const ws = await createWorkspace(db, { name: "port-add", image: "alpine-v1" });
		const port = await addPort(db, { workspaceId: ws.id, port: 3000, label: "frontend" });

		assert.equal(port.workspaceId, ws.id);
		assert.equal(port.port, 3000);
		assert.equal(port.label, "frontend");
		assert.ok(port.createdAt instanceof Date);
	});

	it("listPorts returns added ports", async () => {
		const ws = await createWorkspace(db, { name: "port-list", image: "alpine-v1" });
		await addPort(db, { workspaceId: ws.id, port: 3000 });
		await addPort(db, { workspaceId: ws.id, port: 5000, label: "api" });

		const result = await listPorts(db, ws.id);
		assert.equal(result.length, 2);
		assert.ok(result.some((p) => p.port === 3000));
		assert.ok(result.some((p) => p.port === 5000));
	});

	it("addPort rejects duplicate port for same workspace", async () => {
		const ws = await createWorkspace(db, { name: "port-dup", image: "alpine-v1" });
		await addPort(db, { workspaceId: ws.id, port: 4000 });
		await assert.rejects(() => addPort(db, { workspaceId: ws.id, port: 4000 }));
	});

	it("removePort deletes a specific port", async () => {
		const ws = await createWorkspace(db, { name: "port-remove", image: "alpine-v1" });
		await addPort(db, { workspaceId: ws.id, port: 3000 });
		await addPort(db, { workspaceId: ws.id, port: 5000 });

		await removePort(db, ws.id, 3000);

		const result = await listPorts(db, ws.id);
		assert.equal(result.length, 1);
		assert.equal(result[0].port, 5000);
	});

	it("removeAllPorts deletes all ports for a workspace", async () => {
		const ws = await createWorkspace(db, { name: "port-remove-all", image: "alpine-v1" });
		await addPort(db, { workspaceId: ws.id, port: 3000 });
		await addPort(db, { workspaceId: ws.id, port: 5000 });

		await removeAllPorts(db, ws.id);

		const result = await listPorts(db, ws.id);
		assert.deepEqual(result, []);
	});

	it("ports are cascade-deleted when workspace is deleted", async () => {
		const ws = await createWorkspace(db, { name: "port-cascade", image: "alpine-v1" });
		await addPort(db, { workspaceId: ws.id, port: 8080 });

		await deleteWorkspace(db, ws.id);

		const result = await listPorts(db, ws.id);
		assert.deepEqual(result, []);
	});
});

describe("Count queries", () => {
	let db: DbClient;

	before(() => {
		db = createMemoryDb();
	});

	it("countWorkspaces returns 0 for empty database", async () => {
		const total = await countWorkspaces(db);
		assert.equal(total, 0);
	});

	it("countWorkspaces returns correct count after inserts", async () => {
		await createWorkspace(db, { name: "count-ws-1", image: "alpine-v1" });
		await createWorkspace(db, { name: "count-ws-2", image: "alpine-v1" });

		const total = await countWorkspaces(db);
		assert.equal(total, 2);
	});

	it("countWorkspacesByStatus filters by status", async () => {
		const ws = await createWorkspace(db, { name: "count-status", image: "alpine-v1" });
		await updateWorkspaceStatus(db, ws.id, WS.running, { vmIp: "10.0.1.1" });

		const creating = await countWorkspacesByStatus(db, WS.creating);
		const running = await countWorkspacesByStatus(db, WS.running);

		assert.equal(creating, 2);
		assert.equal(running, 1);
	});

	it("countWorkspaces decreases after delete", async () => {
		const before = await countWorkspaces(db);
		const ws = await createWorkspace(db, { name: "count-delete", image: "alpine-v1" });
		await deleteWorkspace(db, ws.id);
		const after = await countWorkspaces(db);

		assert.equal(after, before);
	});
});
