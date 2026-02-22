import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { DbClient } from "../src/connection.ts";
import { createMemoryDb } from "../src/connection.ts";
import {
	addPort,
	createWorkspace,
	deleteWorkspace,
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

	it("listWorkspaces returns empty array initially", async () => {
		const result = await listWorkspaces(db);
		assert.deepEqual(result, []);
	});

	it("createWorkspace inserts and returns a workspace", async () => {
		const ws = await createWorkspace(db, { name: "test-ws", image: "alpine-v1" });

		assert.equal(typeof ws.id, "string");
		assert.ok(ws.id.length > 0);
		assert.equal(ws.name, "test-ws");
		assert.equal(ws.image, "alpine-v1");
		assert.equal(ws.status, "creating");
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

		const updated = await updateWorkspaceStatus(db, created.id, "running", {
			vmIp: "192.168.64.5",
		});

		assert.notEqual(updated, undefined);
		assert.equal(updated?.status, "running");
		assert.equal(updated?.vmIp, "192.168.64.5");
	});

	it("updateWorkspaceStatus sets error message", async () => {
		const created = await createWorkspace(db, {
			name: "error-test",
			image: "alpine-v1",
		});

		const updated = await updateWorkspaceStatus(db, created.id, "error", {
			errorMessage: "VM creation failed",
		});

		assert.notEqual(updated, undefined);
		assert.equal(updated?.status, "error");
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

	it("listWorkspaces returns all workspaces", async () => {
		const results = await listWorkspaces(db);
		assert.ok(results.length > 0);
	});

	it("createWorkspace rejects duplicate names", async () => {
		await createWorkspace(db, { name: "unique-name", image: "alpine-v1" });
		await assert.rejects(() => createWorkspace(db, { name: "unique-name", image: "alpine-v1" }));
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
