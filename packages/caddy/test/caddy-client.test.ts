import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCaddyClient } from "../src/caddy-client.ts";
import type { AuthMode } from "../src/types.ts";

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

function basicAuthMode(): AuthMode {
	return { mode: "basic", credentials: { username: "admin", passwordHash: "$2a$10$hash" } };
}

function oauthMode(): AuthMode {
	return { mode: "oauth", controlPlaneDial: "127.0.0.1:7163", srv0Port: 8080 };
}

type CaddyConfig = Record<string, unknown>;

describe("CaddyClient", () => {
	describe("addWorkspaceRoute", () => {
		it("sends two POSTs: redirect then proxy route", async () => {
			const { fetch, requests } = createMockFetch();
			const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

			await caddy.addWorkspaceRoute("alice", "10.0.1.50");

			assert.equal(requests.length, 2);

			assert.equal(requests[0].method, "POST");
			assert.equal(requests[0].url, "http://caddy:2019/config/apps/http/servers/srv1/routes");
			const redirect = requests[0].body as CaddyConfig;
			assert.equal(redirect["@id"], "workspace-alice-redirect");
			assert.deepEqual(redirect.match, [{ path: ["/workspace/alice"] }]);

			assert.equal(requests[1].method, "POST");
			assert.equal(requests[1].url, "http://caddy:2019/config/apps/http/servers/srv1/routes");
			const route = requests[1].body as CaddyConfig;
			assert.equal(route["@id"], "workspace-alice");
			assert.deepEqual(route.match, [{ path: ["/workspace/alice/*"] }]);
			assert.equal(route.terminal, true);
		});

		it("builds correct proxy route structure", async () => {
			const { fetch, requests } = createMockFetch();
			const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

			await caddy.addWorkspaceRoute("alice", "10.0.1.50");

			const route = requests[1].body as CaddyConfig;
			const handles = route.handle as Array<CaddyConfig>;

			const rewrite = handles.find((h) => h.handler === "rewrite");
			assert.ok(rewrite);
			assert.equal(rewrite.strip_path_prefix, "/workspace/alice");

			const proxy = handles.find((h) => h.handler === "reverse_proxy");
			assert.ok(proxy);
			assert.deepEqual(proxy.upstreams, [{ dial: "10.0.1.50:8080" }]);
			assert.equal(proxy.flush_interval, -1);
			assert.equal(proxy.stream_timeout, "24h");

			const proxyHeaders = proxy.headers as CaddyConfig;
			const requestHeaders = (proxyHeaders.request as CaddyConfig).set as Record<string, string[]>;
			assert.deepEqual(requestHeaders["X-Forwarded-Prefix"], ["/workspace/alice"]);
		});

		it("includes basic auth handler when basic auth mode is set", async () => {
			const { fetch, requests } = createMockFetch();
			const caddy = createCaddyClient({
				adminUrl: "http://caddy:2019",
				fetch,
				authMode: basicAuthMode(),
			});

			await caddy.addWorkspaceRoute("alice", "10.0.1.50");

			const route = requests[1].body as CaddyConfig;
			const handles = route.handle as Array<CaddyConfig>;
			assert.equal(handles[0].handler, "subroute");
		});

		it("includes forward_auth handler when OAuth mode is set", async () => {
			const { fetch, requests } = createMockFetch();
			const caddy = createCaddyClient({
				adminUrl: "http://caddy:2019",
				fetch,
				authMode: oauthMode(),
			});

			await caddy.addWorkspaceRoute("alice", "10.0.1.50");

			const route = requests[1].body as CaddyConfig;
			const handles = route.handle as Array<CaddyConfig>;
			assert.equal(handles[0].handler, "reverse_proxy");
			assert.deepEqual((handles[0] as CaddyConfig).rewrite, {
				method: "GET",
				uri: "/api/auth/verify",
			});
		});

		it("does not include auth handler when no auth mode is set", async () => {
			const { fetch, requests } = createMockFetch();
			const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

			await caddy.addWorkspaceRoute("alice", "10.0.1.50");

			const route = requests[1].body as CaddyConfig;
			const handles = route.handle as Array<CaddyConfig>;
			assert.equal(handles[0].handler, "rewrite");
		});
	});

	describe("removeWorkspaceRoute", () => {
		it("sends DELETE for both route and redirect", async () => {
			const { fetch, requests } = createMockFetch();
			const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

			await caddy.removeWorkspaceRoute("alice");

			assert.equal(requests.length, 2);
			assert.equal(requests[0].method, "DELETE");
			assert.equal(requests[0].url, "http://caddy:2019/id/workspace-alice");
			assert.equal(requests[1].method, "DELETE");
			assert.equal(requests[1].url, "http://caddy:2019/id/workspace-alice-redirect");
		});

		it("ignores 404 for both route and redirect", async () => {
			const { fetch } = createMockFetch(404);
			const caddy = createCaddyClient({ fetch });

			await caddy.removeWorkspaceRoute("nonexistent");
		});
	});

	describe("addPortRoute", () => {
		it("sends two POSTs to srv2: redirect then proxy route", async () => {
			const { fetch, requests } = createMockFetch();
			const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

			await caddy.addPortRoute("alice", "10.0.1.50", 3000);

			assert.equal(requests.length, 2);

			assert.equal(requests[0].url, "http://caddy:2019/config/apps/http/servers/srv2/routes");
			const redirect = requests[0].body as CaddyConfig;
			assert.equal(redirect["@id"], "workspace-alice-port-3000-redirect");
			assert.deepEqual(redirect.match, [{ path: ["/workspace/alice/port/3000"] }]);

			assert.equal(requests[1].url, "http://caddy:2019/config/apps/http/servers/srv2/routes");
			const route = requests[1].body as CaddyConfig;
			assert.equal(route["@id"], "workspace-alice-port-3000");
			assert.deepEqual(route.match, [{ path: ["/workspace/alice/port/3000/*"] }]);
		});

		it("builds correct port proxy route", async () => {
			const { fetch, requests } = createMockFetch();
			const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

			await caddy.addPortRoute("alice", "10.0.1.50", 3000);

			const route = requests[1].body as CaddyConfig;
			const handles = route.handle as Array<CaddyConfig>;

			const rewrite = handles.find((h) => h.handler === "rewrite");
			assert.ok(rewrite);
			assert.equal(rewrite.strip_path_prefix, "/workspace/alice/port/3000");

			const proxy = handles.find((h) => h.handler === "reverse_proxy");
			assert.ok(proxy);
			assert.deepEqual(proxy.upstreams, [{ dial: "10.0.1.50:3000" }]);
		});

		it("includes forward_auth handler when OAuth mode is set", async () => {
			const { fetch, requests } = createMockFetch();
			const caddy = createCaddyClient({
				adminUrl: "http://caddy:2019",
				fetch,
				authMode: oauthMode(),
			});

			await caddy.addPortRoute("alice", "10.0.1.50", 3000);

			const route = requests[1].body as CaddyConfig;
			const handles = route.handle as Array<CaddyConfig>;
			assert.equal(handles[0].handler, "reverse_proxy");
			assert.deepEqual((handles[0] as CaddyConfig).rewrite, {
				method: "GET",
				uri: "/api/auth/verify",
			});
		});
	});

	describe("removePortRoute", () => {
		it("sends DELETE for both route and redirect", async () => {
			const { fetch, requests } = createMockFetch();
			const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

			await caddy.removePortRoute("alice", 3000);

			assert.equal(requests.length, 2);
			assert.equal(requests[0].method, "DELETE");
			assert.equal(requests[0].url, "http://caddy:2019/id/workspace-alice-port-3000");
			assert.equal(requests[1].method, "DELETE");
			assert.equal(requests[1].url, "http://caddy:2019/id/workspace-alice-port-3000-redirect");
		});
	});

	describe("bootstrap", () => {
		it("sends POST to /load", async () => {
			const { fetch, requests } = createMockFetch();
			const caddy = createCaddyClient({ adminUrl: "http://caddy:2019", fetch });

			const config = { apps: { http: {} } };
			await caddy.bootstrap(config);

			assert.equal(requests.length, 1);
			assert.equal(requests[0].method, "POST");
			assert.equal(requests[0].url, "http://caddy:2019/load");
			assert.deepEqual(requests[0].body, config);
		});
	});

	describe("error handling", () => {
		it("throws on non-ok response", async () => {
			const { fetch } = createMockFetch(500);
			const caddy = createCaddyClient({ fetch });

			await assert.rejects(() => caddy.addWorkspaceRoute("fail", "1.2.3.4"), {
				message: /Caddy addWorkspaceRoute/,
			});
		});
	});
});
