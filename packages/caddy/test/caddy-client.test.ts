import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCaddyClient } from "../src/caddy-client.ts";

interface CapturedRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
}

function createMockFetch(statusCode = 200) {
	const requests: CapturedRequest[] = [];

	async function mockFetch(url: string, init?: RequestInit): Promise<Response> {
		const body = init?.body ? JSON.parse(init.body as string) : undefined;
		const headers: Record<string, string> = {};
		if (init?.headers) {
			const h = init.headers as Record<string, string>;
			for (const [k, v] of Object.entries(h)) {
				headers[k] = v;
			}
		}
		requests.push({
			url,
			method: init?.method ?? "GET",
			headers,
			body,
		});
		return new Response("", { status: statusCode });
	}

	return { fetch: mockFetch, requests };
}

describe("CaddyClient", () => {
	it("addWorkspaceRoute sends POST with correct route structure", async () => {
		const { fetch, requests } = createMockFetch();
		const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

		await caddy.addWorkspaceRoute("alice", "10.0.1.50");

		assert.equal(requests.length, 1);
		assert.equal(requests[0].method, "POST");
		assert.equal(requests[0].url, "http://caddy:2019/config/apps/http/servers/srv1/routes");

		const route = requests[0].body as Record<string, unknown>;
		assert.equal(route["@id"], "workspace-alice");
		assert.deepEqual(route.match, [{ path: ["/workspace/alice/*"] }]);
		assert.equal(route.terminal, true);

		const handles = route.handle as Array<Record<string, unknown>>;
		assert.equal(handles[0].handler, "subroute");

		const subroutes = handles[0].routes as Array<Record<string, unknown>>;
		const innerHandles = subroutes[0].handle as Array<Record<string, unknown>>;
		assert.equal(innerHandles[0].handler, "rewrite");
		assert.equal((innerHandles[0] as Record<string, string>).strip_path_prefix, "/workspace/alice");
		assert.equal(innerHandles[1].handler, "reverse_proxy");
		assert.deepEqual(innerHandles[1].upstreams, [{ dial: "10.0.1.50:8080" }]);
	});

	it("removeWorkspaceRoute sends DELETE by route id", async () => {
		const { fetch, requests } = createMockFetch();
		const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

		await caddy.removeWorkspaceRoute("alice");

		assert.equal(requests.length, 1);
		assert.equal(requests[0].method, "DELETE");
		assert.equal(requests[0].url, "http://caddy:2019/id/workspace-alice");
	});

	it("removeWorkspaceRoute ignores 404", async () => {
		const { fetch } = createMockFetch(404);
		const caddy = createCaddyClient({ fetch });

		await caddy.removeWorkspaceRoute("nonexistent");
	});

	it("addPortRoute sends POST with correct port route structure", async () => {
		const { fetch, requests } = createMockFetch();
		const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

		await caddy.addPortRoute("alice", "10.0.1.50", 3000);

		assert.equal(requests.length, 1);
		assert.equal(requests[0].url, "http://caddy:2019/config/apps/http/servers/srv1/routes");
		const route = requests[0].body as Record<string, unknown>;
		assert.equal(route["@id"], "workspace-alice-port-3000");
		assert.deepEqual(route.match, [{ path: ["/workspace/alice/port/3000/*"] }]);

		const handles = route.handle as Array<Record<string, unknown>>;
		assert.equal(handles[0].handler, "rewrite");
		assert.equal(
			(handles[0] as Record<string, string>).strip_path_prefix,
			"/workspace/alice/port/3000",
		);
		assert.equal(handles[1].handler, "reverse_proxy");
		assert.deepEqual(handles[1].upstreams, [{ dial: "10.0.1.50:3000" }]);
	});

	it("removePortRoute sends DELETE by port route id", async () => {
		const { fetch, requests } = createMockFetch();
		const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

		await caddy.removePortRoute("alice", 3000);

		assert.equal(requests.length, 1);
		assert.equal(requests[0].method, "DELETE");
		assert.equal(requests[0].url, "http://caddy:2019/id/workspace-alice-port-3000");
	});

	it("bootstrap sends POST to /load", async () => {
		const { fetch, requests } = createMockFetch();
		const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

		const config = { apps: { http: {} } };
		await caddy.bootstrap(config);

		assert.equal(requests.length, 1);
		assert.equal(requests[0].method, "POST");
		assert.equal(requests[0].url, "http://caddy:2019/load");
		assert.deepEqual(requests[0].body, config);
	});

	it("throws on non-ok response", async () => {
		const { fetch } = createMockFetch(500);
		const caddy = createCaddyClient({ fetch });

		await assert.rejects(() => caddy.addWorkspaceRoute("fail", "1.2.3.4"), {
			message: /Caddy addWorkspaceRoute: 500/,
		});
	});
});
