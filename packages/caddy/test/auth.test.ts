import assert from "node:assert/strict";
import { describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { buildBootstrapConfig, buildForwardAuthHandler, hashPassword } from "../src/auth.ts";
import type { AuthMode } from "../src/types.ts";

type CaddyConfig = Record<string, unknown>;

function getServers(config: CaddyConfig): CaddyConfig {
	const http = (config.apps as CaddyConfig).http as CaddyConfig;
	return http.servers as CaddyConfig;
}

function getSrv0Routes(config: CaddyConfig): Array<Record<string, unknown>> {
	const srv0 = getServers(config).srv0 as CaddyConfig;
	return srv0.routes as Array<Record<string, unknown>>;
}

function getSrv1Routes(config: CaddyConfig): Array<Record<string, unknown>> {
	const srv1 = getServers(config).srv1 as CaddyConfig;
	return srv1.routes as Array<Record<string, unknown>>;
}

function getSrv2Routes(config: CaddyConfig): Array<Record<string, unknown>> {
	const srv2 = getServers(config).srv2 as CaddyConfig;
	return srv2.routes as Array<Record<string, unknown>>;
}

function findRoute(routes: Array<Record<string, unknown>>, id: string): Record<string, unknown> {
	const route = routes.find((r) => r["@id"] === id);
	assert.ok(route, `Expected to find route with @id "${id}"`);
	return route;
}

function basicAuthMode(username = "admin", passwordHash = "$2a$10$fakehashvalue"): AuthMode {
	return { mode: "basic", credentials: { username, passwordHash } };
}

function oauthMode(controlPlaneDial = "127.0.0.1:7163", srv0Port = 8080): AuthMode {
	return { mode: "oauth", controlPlaneDial, srv0Port };
}

describe("hashPassword", () => {
	it("produces a valid bcrypt hash", async () => {
		const hash = await hashPassword("secret");

		assert.match(hash, /^\$2[aby]\$\d{2}\$/);
		assert.equal(hash.length, 60);
	});

	it("produces a hash that verifies against the original password", async () => {
		const hash = await hashPassword("my-password");

		assert.equal(bcrypt.compareSync("my-password", hash), true);
		assert.equal(bcrypt.compareSync("wrong-password", hash), false);
	});

	it("produces different hashes for the same password", async () => {
		const hash1 = await hashPassword("same");
		const hash2 = await hashPassword("same");

		assert.notEqual(hash1, hash2);
	});
});

describe("buildForwardAuthHandler", () => {
	it("returns a reverse_proxy handler with verify rewrite", () => {
		const handler = buildForwardAuthHandler("127.0.0.1:7163", 8080);

		assert.equal(handler.handler, "reverse_proxy");
		assert.deepEqual(handler.upstreams, [{ dial: "127.0.0.1:7163" }]);
		assert.deepEqual(handler.rewrite, { method: "GET", uri: "/api/auth/verify" });
	});

	it("sets X-Forwarded-* headers in the auth subrequest", () => {
		const handler = buildForwardAuthHandler("127.0.0.1:7163", 8080);

		const headers = handler.headers as CaddyConfig;
		const requestHeaders = headers.request as CaddyConfig;
		const setHeaders = requestHeaders.set as Record<string, string[]>;
		assert.deepEqual(setHeaders["X-Forwarded-Method"], ["{http.request.method}"]);
		assert.deepEqual(setHeaders["X-Forwarded-Uri"], ["{http.request.uri}"]);
		assert.deepEqual(setHeaders["X-Forwarded-Host"], ["{http.request.host}"]);
		assert.deepEqual(setHeaders["X-Forwarded-Proto"], ["{http.request.scheme}"]);
	});

	it("copies X-Authenticated-User on 2xx response", () => {
		const handler = buildForwardAuthHandler("127.0.0.1:7163", 8080);

		const responses = handler.handle_response as Array<Record<string, unknown>>;
		const successResponse = responses.find(
			(r) =>
				(r.match as CaddyConfig).status_code !== undefined &&
				((r.match as CaddyConfig).status_code as number[]).includes(2),
		);
		assert.ok(successResponse);

		const routes = successResponse.routes as Array<Record<string, unknown>>;
		const handles = routes[0].handle as Array<Record<string, unknown>>;
		assert.equal(handles[0].handler, "headers");
	});

	it("redirects to login on 401 with return_to", () => {
		const handler = buildForwardAuthHandler("127.0.0.1:7163", 9090);

		const responses = handler.handle_response as Array<Record<string, unknown>>;
		const unauthorizedResponse = responses.find(
			(r) =>
				(r.match as CaddyConfig).status_code !== undefined &&
				((r.match as CaddyConfig).status_code as number[]).includes(401),
		);
		assert.ok(unauthorizedResponse);

		const routes = unauthorizedResponse.routes as Array<Record<string, unknown>>;
		const handles = routes[0].handle as Array<Record<string, unknown>>;
		assert.equal(handles[0].handler, "static_response");
		assert.equal((handles[0] as CaddyConfig).status_code, 302);

		const headers = (handles[0] as CaddyConfig).headers as Record<string, string[]>;
		const location = headers.Location[0];
		assert.ok(location.includes(":9090/api/auth/github"));
		assert.ok(location.includes("return_to="));
	});
});

describe("buildBootstrapConfig", () => {
	it("returns three-server config with health-check route when no options given", () => {
		const config = buildBootstrapConfig();

		const servers = getServers(config);
		const srv0 = servers.srv0 as CaddyConfig;
		const srv1 = servers.srv1 as CaddyConfig;
		const srv2 = servers.srv2 as CaddyConfig;

		assert.deepEqual(srv0.listen, [":8080"]);
		const routes = srv0.routes as Array<Record<string, unknown>>;
		assert.equal(routes.length, 1);
		assert.equal(routes[0]["@id"], "health-check");

		assert.deepEqual(srv1.listen, [":8081"]);
		assert.deepEqual(srv1.routes, []);

		assert.deepEqual(srv2.listen, [":8082"]);
		assert.deepEqual(srv2.routes, []);
	});

	it("adds basic auth gate on srv0 when basic auth mode is set", () => {
		const config = buildBootstrapConfig({ authMode: basicAuthMode() });
		const routes = getSrv0Routes(config);

		assert.equal(routes.length, 2);
		assert.equal(routes[0]["@id"], "health-check");
		assert.equal(routes[1]["@id"], "auth-gate");
	});

	it("configures basic auth gate for /api/* and /app/* paths", () => {
		const config = buildBootstrapConfig({ authMode: basicAuthMode() });
		const routes = getSrv0Routes(config);

		const authRoute = findRoute(routes, "auth-gate");
		assert.deepEqual(authRoute.match, [{ path: ["/api/*", "/app/*"] }]);
	});

	it("includes authentication handler with correct credentials", () => {
		const config = buildBootstrapConfig({
			authMode: basicAuthMode("rockpool", "$2a$10$specificHash"),
		});
		const routes = getSrv0Routes(config);

		const authRoute = findRoute(routes, "auth-gate");
		const handles = authRoute.handle as Array<Record<string, unknown>>;
		const authHandler = handles[0];

		assert.equal(authHandler.handler, "authentication");

		const providers = authHandler.providers as CaddyConfig;
		const httpBasic = providers.http_basic as CaddyConfig;
		const accounts = httpBasic.accounts as Array<Record<string, unknown>>;

		assert.equal(accounts.length, 1);
		assert.equal(accounts[0].username, "rockpool");
		assert.equal(accounts[0].password, "$2a$10$specificHash");
	});

	it("adds basic auth gate to srv1 for /workspace/* when basic auth mode is set", () => {
		const config = buildBootstrapConfig({ authMode: basicAuthMode() });
		const routes = getSrv1Routes(config);

		assert.equal(routes.length, 1);
		assert.equal(routes[0]["@id"], "srv1-auth-gate");
		assert.deepEqual(routes[0].match, [{ path: ["/workspace/*"] }]);

		const handles = routes[0].handle as Array<Record<string, unknown>>;
		assert.equal(handles[0].handler, "authentication");
	});

	it("adds basic auth gate to srv2 for /workspace/* when basic auth mode is set", () => {
		const config = buildBootstrapConfig({ authMode: basicAuthMode() });
		const routes = getSrv2Routes(config);

		assert.equal(routes.length, 1);
		assert.equal(routes[0]["@id"], "srv2-auth-gate");
		assert.deepEqual(routes[0].match, [{ path: ["/workspace/*"] }]);

		const handles = routes[0].handle as Array<Record<string, unknown>>;
		assert.equal(handles[0].handler, "authentication");
	});

	it("does not add auth routes to srv1 or srv2 when no auth mode is set", () => {
		const config = buildBootstrapConfig({});

		assert.deepEqual(getSrv1Routes(config), []);
		assert.deepEqual(getSrv2Routes(config), []);
	});

	it("does not add auth gate on srv0 when OAuth mode is set", () => {
		const config = buildBootstrapConfig({ authMode: oauthMode() });
		const routes = getSrv0Routes(config);

		const ids = routes.map((r) => r["@id"]);
		assert.ok(!ids.includes("auth-gate"));
	});

	it("adds forward_auth gate to srv1 when OAuth mode is set", () => {
		const config = buildBootstrapConfig({ authMode: oauthMode() });
		const routes = getSrv1Routes(config);

		assert.equal(routes.length, 1);
		assert.equal(routes[0]["@id"], "srv1-auth-gate");
		assert.deepEqual(routes[0].match, [{ path: ["/workspace/*"] }]);

		const handles = routes[0].handle as Array<Record<string, unknown>>;
		assert.equal(handles[0].handler, "reverse_proxy");
		assert.deepEqual((handles[0] as CaddyConfig).rewrite, {
			method: "GET",
			uri: "/api/auth/verify",
		});
	});

	it("adds forward_auth gate to srv2 when OAuth mode is set", () => {
		const config = buildBootstrapConfig({ authMode: oauthMode() });
		const routes = getSrv2Routes(config);

		assert.equal(routes.length, 1);
		assert.equal(routes[0]["@id"], "srv2-auth-gate");

		const handles = routes[0].handle as Array<Record<string, unknown>>;
		assert.equal(handles[0].handler, "reverse_proxy");
	});

	it("forward_auth uses correct control plane dial and srv0 port", () => {
		const config = buildBootstrapConfig({
			authMode: oauthMode("10.0.0.1:7163", 9090),
		});
		const routes = getSrv1Routes(config);
		const handles = routes[0].handle as Array<Record<string, unknown>>;
		const handler = handles[0] as CaddyConfig;

		assert.deepEqual(handler.upstreams, [{ dial: "10.0.0.1:7163" }]);
		const responses = handler.handle_response as Array<Record<string, unknown>>;
		const unauthorizedResponse = responses.find((r) =>
			((r.match as CaddyConfig).status_code as number[]).includes(401),
		);
		assert.ok(unauthorizedResponse);
		const innerRoutes = unauthorizedResponse.routes as Array<Record<string, unknown>>;
		const innerHandles = innerRoutes[0].handle as Array<Record<string, unknown>>;
		const headers = (innerHandles[0] as CaddyConfig).headers as Record<string, string[]>;
		assert.ok(headers.Location[0].includes(":9090/api/auth/github"));
	});

	it("adds API proxy route when controlPlaneUrl is provided", () => {
		const config = buildBootstrapConfig({ controlPlaneUrl: "http://localhost:7163" });
		const routes = getSrv0Routes(config);

		const apiRoute = findRoute(routes, "api-proxy");
		assert.deepEqual(apiRoute.match, [{ path: ["/api/*"] }]);
		assert.equal(apiRoute.terminal, true);

		const handles = apiRoute.handle as Array<Record<string, unknown>>;
		assert.equal(handles[0].handler, "reverse_proxy");
		const upstreams = (handles[0] as CaddyConfig).upstreams as Array<Record<string, unknown>>;
		assert.equal(upstreams[0].dial, "127.0.0.1:7163");
	});

	it("adds SPA routes when spaRoot is provided", () => {
		const config = buildBootstrapConfig({ spaRoot: "/opt/rockpool/client" });
		const routes = getSrv0Routes(config);

		const assetsRoute = findRoute(routes, "spa-assets");
		assert.deepEqual(assetsRoute.match, [{ path: ["/app/assets/*"] }]);
		assert.equal(assetsRoute.terminal, true);
		const assetsHandles = assetsRoute.handle as Array<Record<string, unknown>>;
		const fileServer = assetsHandles.find((h) => h.handler === "file_server") as CaddyConfig;
		assert.equal(fileServer.root, "/opt/rockpool/client");

		const fallbackRoute = findRoute(routes, "spa-fallback");
		assert.deepEqual(fallbackRoute.match, [{ path: ["/app", "/app/*"] }]);
		assert.equal(fallbackRoute.terminal, true);
	});

	it("adds workspace redirect to srv1 when srv1Port is provided", () => {
		const config = buildBootstrapConfig({ srv1Port: 8081 });
		const routes = getSrv0Routes(config);

		const redirect = findRoute(routes, "workspace-redirect");
		assert.deepEqual(redirect.match, [{ path: ["/workspace/*"] }]);
		assert.equal(redirect.terminal, true);

		const handles = redirect.handle as Array<Record<string, unknown>>;
		const staticResponse = handles[0] as CaddyConfig;
		assert.equal(staticResponse.status_code, 302);
		const headers = staticResponse.headers as Record<string, string[]>;
		assert.deepEqual(headers.Location, [
			"{http.request.scheme}://{http.request.host}:8081{http.request.uri}",
		]);
	});

	it("uses configured srv1Port in workspace redirect", () => {
		const config = buildBootstrapConfig({ srv1Port: 9999 });
		const routes = getSrv0Routes(config);

		const redirect = findRoute(routes, "workspace-redirect");
		const handles = redirect.handle as Array<Record<string, unknown>>;
		const staticResponse = handles[0] as CaddyConfig;
		const headers = staticResponse.headers as Record<string, string[]>;
		assert.deepEqual(headers.Location, [
			"{http.request.scheme}://{http.request.host}:9999{http.request.uri}",
		]);
	});

	it("does not add workspace redirect when srv1Port is not set", () => {
		const config = buildBootstrapConfig({ controlPlaneUrl: "http://localhost:7163" });
		const routes = getSrv0Routes(config);
		const ids = routes.map((r) => r["@id"]);

		assert.ok(!ids.includes("workspace-redirect"));
	});

	it("adds root redirect when controlPlaneUrl is provided", () => {
		const config = buildBootstrapConfig({ controlPlaneUrl: "http://localhost:7163" });
		const routes = getSrv0Routes(config);

		const redirect = findRoute(routes, "root-redirect");
		assert.deepEqual(redirect.match, [{ path: ["/"] }]);
		assert.equal(redirect.terminal, true);

		const handles = redirect.handle as Array<Record<string, unknown>>;
		const staticResponse = handles[0] as CaddyConfig;
		assert.equal(staticResponse.status_code, 302);
		const headers = staticResponse.headers as Record<string, string[]>;
		assert.deepEqual(headers.Location, ["/app/workspaces"]);
	});

	it("combines auth, API proxy, SPA, workspace redirect, and root redirect in order", () => {
		const config = buildBootstrapConfig({
			authMode: basicAuthMode("admin", "$2a$10$hash"),
			controlPlaneUrl: "http://localhost:7163",
			spaRoot: "/opt/rockpool/client",
			srv1Port: 8081,
		});
		const routes = getSrv0Routes(config);

		const ids = routes.map((r) => r["@id"]);
		assert.deepEqual(ids, [
			"health-check",
			"auth-gate",
			"api-proxy",
			"spa-assets",
			"spa-fallback",
			"workspace-redirect",
			"root-redirect",
		]);
	});

	it("does not add redirect when neither controlPlaneUrl nor spaRoot is set", () => {
		const config = buildBootstrapConfig({
			authMode: basicAuthMode("admin", "$2a$10$hash"),
		});
		const routes = getSrv0Routes(config);
		const ids = routes.map((r) => r["@id"]);

		assert.ok(!ids.includes("root-redirect"));
	});

	it("uses custom srv2Port when provided", () => {
		const config = buildBootstrapConfig({ srv2Port: 9082 });
		const servers = getServers(config);
		const srv2 = servers.srv2 as CaddyConfig;
		assert.deepEqual(srv2.listen, [":9082"]);
	});

	it("srv1 uses configured srv1Port for listen address", () => {
		const config = buildBootstrapConfig({ srv1Port: 9081 });
		const servers = getServers(config);
		const srv1 = servers.srv1 as CaddyConfig;
		assert.deepEqual(srv1.listen, [":9081"]);
	});
});
