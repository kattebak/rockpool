import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import type { CaddyRepository } from "@tdpl/caddy";
import type { DbClient } from "@tdpl/db";
import { createMemoryDb, createWorkspace, updateWorkspaceStatus } from "@tdpl/db";
import { createMemoryQueue } from "@tdpl/queue";
import pino from "pino";
import { createApp } from "../src/app.ts";
import { createPortService } from "../src/services/port-service.ts";
import { createWorkspaceService } from "../src/services/workspace-service.ts";

function request(
	server: http.Server,
	method: string,
	path: string,
	body?: unknown,
): Promise<{ status: number; body: unknown }> {
	return new Promise((resolve, reject) => {
		const addr = server.address() as { port: number };
		const options = {
			hostname: "127.0.0.1",
			port: addr.port,
			path,
			method,
			headers: { "Content-Type": "application/json" },
		};

		const req = http.request(options, (res) => {
			let data = "";
			res.on("data", (chunk) => {
				data += chunk;
			});
			res.on("end", () => {
				const parsed = data ? JSON.parse(data) : null;
				resolve({ status: res.statusCode ?? 0, body: parsed });
			});
		});

		req.on("error", reject);
		if (body) {
			req.write(JSON.stringify(body));
		}
		req.end();
	});
}

describe("API", () => {
	let server: http.Server;

	before((_, done) => {
		const db = createMemoryDb();
		const queue = createMemoryQueue();
		const workspaceService = createWorkspaceService({ db, queue });
		const logger = pino({ level: "silent" });
		const app = createApp({ workspaceService, logger });
		server = app.listen(0, done);
	});

	after((_, done) => {
		server.close(done);
	});

	it("GET /api/health returns ok", async () => {
		const res = await request(server, "GET", "/api/health");
		assert.equal(res.status, 200);
		assert.deepEqual(res.body, { status: "ok" });
	});

	it("GET /api/workspaces returns empty paginated result", async () => {
		const res = await request(server, "GET", "/api/workspaces");
		assert.equal(res.status, 200);
		const body = res.body as { items: unknown[]; nextCursor?: string };
		assert.deepEqual(body.items, []);
		assert.equal(body.nextCursor, undefined);
	});

	it("POST /api/workspaces creates a workspace", async () => {
		const res = await request(server, "POST", "/api/workspaces", {
			name: "test-ws",
			image: "alpine-v1",
		});
		assert.equal(res.status, 201);
		const ws = res.body as Record<string, unknown>;
		assert.equal(ws.name, "test-ws");
		assert.equal(ws.image, "alpine-v1");
		assert.equal(ws.status, "creating");
		assert.equal(typeof ws.id, "string");
	});

	it("GET /api/workspaces lists the created workspace", async () => {
		const res = await request(server, "GET", "/api/workspaces");
		assert.equal(res.status, 200);
		const body = res.body as { items: Array<Record<string, unknown>> };
		assert.ok(body.items.length >= 1);
		assert.ok(body.items.some((ws) => ws.name === "test-ws"));
	});

	it("GET /api/workspaces/:id returns the workspace", async () => {
		const listRes = await request(server, "GET", "/api/workspaces");
		const listBody = listRes.body as { items: Array<Record<string, unknown>> };
		const ws = listBody.items.find((w) => w.name === "test-ws");
		assert.ok(ws, "Expected to find test-ws in list");

		const res = await request(server, "GET", `/api/workspaces/${ws.id}`);
		assert.equal(res.status, 200);
		const detail = res.body as Record<string, unknown>;
		assert.equal(detail.name, "test-ws");
	});

	it("GET /api/workspaces/:id returns 404 for missing workspace", async () => {
		const res = await request(server, "GET", "/api/workspaces/nonexistent");
		assert.equal(res.status, 404);
	});

	it("POST /api/workspaces rejects duplicate name", async () => {
		const res = await request(server, "POST", "/api/workspaces", {
			name: "test-ws",
			image: "alpine-v1",
		});
		assert.equal(res.status, 409);
	});

	it("POST /api/workspaces/:id/stop transitions to stopping", async () => {
		const createRes = await request(server, "POST", "/api/workspaces", {
			name: "stop-test",
			image: "alpine-v1",
		});
		const ws = createRes.body as Record<string, unknown>;

		const res = await request(server, "POST", `/api/workspaces/${ws.id}/stop`);
		assert.equal(res.status, 409);
	});

	it("POST /api/workspaces returns 400 when name is missing", async () => {
		const res = await request(server, "POST", "/api/workspaces", {
			image: "alpine-v1",
		});
		assert.equal(res.status, 400);
		const body = res.body as Record<string, Record<string, unknown>>;
		assert.equal(body.error.code, "validation_error");
	});

	it("POST /api/workspaces returns 400 when name violates pattern", async () => {
		const res = await request(server, "POST", "/api/workspaces", {
			name: "INVALID_NAME",
			image: "alpine-v1",
		});
		assert.equal(res.status, 400);
		const body = res.body as Record<string, Record<string, unknown>>;
		assert.equal(body.error.code, "validation_error");
	});

	it("POST /api/workspaces returns 400 when name is too short", async () => {
		const res = await request(server, "POST", "/api/workspaces", {
			name: "ab",
			image: "alpine-v1",
		});
		assert.equal(res.status, 400);
		const body = res.body as Record<string, Record<string, unknown>>;
		assert.equal(body.error.code, "validation_error");
	});

	it("POST /api/workspaces returns 400 when body is empty", async () => {
		const res = await request(server, "POST", "/api/workspaces", {});
		assert.equal(res.status, 400);
		const body = res.body as Record<string, Record<string, unknown>>;
		assert.equal(body.error.code, "validation_error");
	});

	it("GET /api/workspaces respects limit query param", async () => {
		const res = await request(server, "GET", "/api/workspaces?limit=1");
		assert.equal(res.status, 200);
		const body = res.body as { items: unknown[]; nextCursor?: string };
		assert.equal(body.items.length, 1);
		assert.ok(body.nextCursor);
	});

	it("GET /api/workspaces paginates with cursor", async () => {
		const firstPage = await request(server, "GET", "/api/workspaces?limit=1");
		assert.equal(firstPage.status, 200);
		const firstBody = firstPage.body as {
			items: Array<Record<string, unknown>>;
			nextCursor?: string;
		};
		assert.ok(firstBody.nextCursor);

		const secondPage = await request(
			server,
			"GET",
			`/api/workspaces?limit=1&cursor=${firstBody.nextCursor}`,
		);
		assert.equal(secondPage.status, 200);
		const secondBody = secondPage.body as {
			items: Array<Record<string, unknown>>;
			nextCursor?: string;
		};
		assert.equal(secondBody.items.length, 1);
		assert.notEqual(firstBody.items[0].id, secondBody.items[0].id);
	});

	it("GET /api/workspaces clamps limit above 100 to 100", async () => {
		const res = await request(server, "GET", "/api/workspaces?limit=999");
		assert.equal(res.status, 200);
		const body = res.body as { items: unknown[] };
		assert.ok(body.items.length <= 100);
	});

	it("GET /api/workspaces defaults limit when not provided", async () => {
		const res = await request(server, "GET", "/api/workspaces");
		assert.equal(res.status, 200);
		const body = res.body as { items: unknown[] };
		assert.ok(body.items.length <= 25);
	});
});

function createMockCaddy(): CaddyRepository & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async addWorkspaceRoute(name: string, _vmIp: string) {
			calls.push(`addRoute:${name}`);
		},
		async removeWorkspaceRoute(name: string) {
			calls.push(`removeRoute:${name}`);
		},
		async addPortRoute(workspaceName: string, _vmIp: string, port: number) {
			calls.push(`addPort:${workspaceName}:${port}`);
		},
		async removePortRoute(workspaceName: string, port: number) {
			calls.push(`removePort:${workspaceName}:${port}`);
		},
		async bootstrap(_config: unknown) {
			calls.push("bootstrap");
		},
	};
}

describe("Port API", () => {
	let server: http.Server;
	let db: DbClient;
	let mockCaddy: CaddyRepository & { calls: string[] };
	let runningWorkspaceId: string;

	before(async () => {
		db = createMemoryDb();
		const queue = createMemoryQueue();
		mockCaddy = createMockCaddy();
		const workspaceService = createWorkspaceService({ db, queue });
		const portService = createPortService({ db, caddy: mockCaddy });
		const logger = pino({ level: "silent" });
		const app = createApp({ workspaceService, portService, logger });

		const ws = await createWorkspace(db, { name: "port-test-ws", image: "alpine-v1" });
		await updateWorkspaceStatus(db, ws.id, "running", { vmIp: "10.0.1.50" });
		runningWorkspaceId = ws.id;

		await new Promise<void>((resolve) => {
			server = app.listen(0, () => resolve());
		});
	});

	after((_, done) => {
		server.close(done);
	});

	it("GET /api/workspaces/:id/ports returns empty list", async () => {
		const res = await request(server, "GET", `/api/workspaces/${runningWorkspaceId}/ports`);
		assert.equal(res.status, 200);
		assert.deepEqual(res.body, []);
	});

	it("POST /api/workspaces/:id/ports registers a port", async () => {
		const res = await request(server, "POST", `/api/workspaces/${runningWorkspaceId}/ports`, {
			port: 3000,
			label: "frontend",
		});
		assert.equal(res.status, 201);
		const port = res.body as Record<string, unknown>;
		assert.equal(port.port, 3000);
		assert.equal(port.label, "frontend");
		assert.ok(mockCaddy.calls.includes("addPort:port-test-ws:3000"));
	});

	it("GET /api/workspaces/:id/ports lists registered ports", async () => {
		const res = await request(server, "GET", `/api/workspaces/${runningWorkspaceId}/ports`);
		assert.equal(res.status, 200);
		const ports = res.body as Array<Record<string, unknown>>;
		assert.equal(ports.length, 1);
		assert.equal(ports[0].port, 3000);
	});

	it("POST /api/workspaces/:id/ports rejects duplicate port", async () => {
		const res = await request(server, "POST", `/api/workspaces/${runningWorkspaceId}/ports`, {
			port: 3000,
		});
		assert.equal(res.status, 409);
	});

	it("POST /api/workspaces/:id/ports returns 400 for invalid port number", async () => {
		const res = await request(server, "POST", `/api/workspaces/${runningWorkspaceId}/ports`, {
			port: 80,
		});
		assert.equal(res.status, 400);
	});

	it("DELETE /api/workspaces/:id/ports/:port removes a port", async () => {
		const res = await request(server, "DELETE", `/api/workspaces/${runningWorkspaceId}/ports/3000`);
		assert.equal(res.status, 204);
		assert.ok(mockCaddy.calls.includes("removePort:port-test-ws:3000"));
	});

	it("GET /api/workspaces/:id/ports returns empty after removal", async () => {
		const res = await request(server, "GET", `/api/workspaces/${runningWorkspaceId}/ports`);
		assert.equal(res.status, 200);
		assert.deepEqual(res.body, []);
	});

	it("POST /api/workspaces/:id/ports returns 404 for missing workspace", async () => {
		const res = await request(server, "POST", "/api/workspaces/nonexistent/ports", {
			port: 3000,
		});
		assert.equal(res.status, 404);
	});

	it("POST /api/workspaces/:id/ports rejects when workspace not running", async () => {
		const ws = await createWorkspace(db, { name: "port-stopped-ws", image: "alpine-v1" });
		const res = await request(server, "POST", `/api/workspaces/${ws.id}/ports`, {
			port: 3000,
		});
		assert.equal(res.status, 409);
	});
});
