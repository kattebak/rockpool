import assert from "node:assert/strict";
import { describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { buildBootstrapConfig, hashPassword } from "../src/auth.ts";
import type { BasicAuthCredentials } from "../src/types.ts";

type CaddyConfig = Record<string, unknown>;

function getSrv0Routes(config: CaddyConfig): Array<Record<string, unknown>> {
	const servers = (config.apps as CaddyConfig).http as CaddyConfig;
	const srv0 = (servers.servers as CaddyConfig).srv0 as CaddyConfig;
	return srv0.routes as Array<Record<string, unknown>>;
}

function getSrv1Routes(config: CaddyConfig): Array<Record<string, unknown>> {
	const servers = (config.apps as CaddyConfig).http as CaddyConfig;
	const srv1 = (servers.servers as CaddyConfig).srv1 as CaddyConfig;
	return srv1.routes as Array<Record<string, unknown>>;
}

function findRoute(routes: Array<Record<string, unknown>>, id: string): Record<string, unknown> {
	const route = routes.find((r) => r["@id"] === id);
	assert.ok(route, `Expected to find route with @id "${id}"`);
	return route;
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

describe("buildBootstrapConfig", () => {
	it("returns two-port config with health-check route when no options given", () => {
		const config = buildBootstrapConfig();

		const servers = (config.apps as CaddyConfig).http as CaddyConfig;
		const srv0 = (servers.servers as CaddyConfig).srv0 as CaddyConfig;
		const srv1 = (servers.servers as CaddyConfig).srv1 as CaddyConfig;

		assert.deepEqual(srv0.listen, [":8080"]);
		const routes = srv0.routes as Array<Record<string, unknown>>;
		assert.equal(routes.length, 1);
		assert.equal(routes[0]["@id"], "health-check");
		assert.deepEqual(srv1.listen, [":8081"]);
		assert.deepEqual(srv1.routes, []);
	});

	it("adds auth gate after health-check when credentials provided", () => {
		const auth: BasicAuthCredentials = {
			username: "admin",
			passwordHash: "$2a$10$fakehashvalue",
		};
		const config = buildBootstrapConfig({ auth });
		const routes = getSrv0Routes(config);

		assert.equal(routes.length, 2);
		assert.equal(routes[0]["@id"], "health-check");
		assert.equal(routes[1]["@id"], "auth-gate");
	});

	it("configures auth gate for /api/* and /app/* paths", () => {
		const auth: BasicAuthCredentials = {
			username: "admin",
			passwordHash: "$2a$10$fakehashvalue",
		};
		const config = buildBootstrapConfig({ auth });
		const routes = getSrv0Routes(config);

		const authRoute = findRoute(routes, "auth-gate");
		assert.deepEqual(authRoute.match, [{ path: ["/api/*", "/app/*"] }]);
	});

	it("includes authentication handler with correct credentials", () => {
		const auth: BasicAuthCredentials = {
			username: "rockpool",
			passwordHash: "$2a$10$specificHash",
		};
		const config = buildBootstrapConfig({ auth });
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

	it("adds auth gate to srv1 for /workspace/* when credentials provided", () => {
		const auth: BasicAuthCredentials = {
			username: "admin",
			passwordHash: "$2a$10$fakehashvalue",
		};
		const config = buildBootstrapConfig({ auth });
		const routes = getSrv1Routes(config);

		assert.equal(routes.length, 1);
		assert.equal(routes[0]["@id"], "srv1-auth-gate");
		assert.deepEqual(routes[0].match, [{ path: ["/workspace/*"] }]);

		const handles = routes[0].handle as Array<Record<string, unknown>>;
		assert.equal(handles[0].handler, "authentication");
	});

	it("does not add auth routes to srv1 when no credentials provided", () => {
		const config = buildBootstrapConfig({});

		assert.deepEqual(getSrv1Routes(config), []);
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
			"{http.request.scheme}://{http.request.hostname}:8081{http.request.uri}",
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
			"{http.request.scheme}://{http.request.hostname}:9999{http.request.uri}",
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
			auth: { username: "admin", passwordHash: "$2a$10$hash" },
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
			auth: { username: "admin", passwordHash: "$2a$10$hash" },
		});
		const routes = getSrv0Routes(config);
		const ids = routes.map((r) => r["@id"]);

		assert.ok(!ids.includes("root-redirect"));
	});
});
