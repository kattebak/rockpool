import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RockpoolConfig } from "@rockpool/config";
import { parse } from "yaml";
import { generateCompose } from "../src/compose.ts";

function makeConfig(overrides: Partial<RockpoolConfig> = {}): RockpoolConfig {
	return {
		logLevel: "info",
		runtime: "podman",
		server: { secureCookies: false },
		auth: { mode: "basic", basic: { username: "admin", password: "admin" } },
		spa: { root: "", proxyUrl: "" },
		ports: { http: 8080, ide: 8081, preview: 8082, caddy: 2019 },
		...overrides,
	};
}

describe("generateCompose", () => {
	it("generates valid YAML with default ports", () => {
		const config = makeConfig();
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.config.json",
			configPath: "/home/user/rockpool/rockpool.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.ok(doc.services.caddy);
		assert.ok(doc.services.elasticmq);
		assert.ok(doc.services["control-plane"]);

		assert.deepStrictEqual(doc.services.caddy.ports, [
			"2019:2019",
			"8080:8080",
			"8081:8081",
			"8082:8082",
		]);
	});

	it("uses custom ports when configured", () => {
		const config = makeConfig({
			ports: { http: 9080, ide: 9081, preview: 9082, caddy: 9019 },
		});
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.test.config.json",
			configPath: "/home/user/rockpool/rockpool.test.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.deepStrictEqual(doc.services.caddy.ports, [
			"9019:9019",
			"9080:9080",
			"9081:9081",
			"9082:9082",
		]);
		assert.strictEqual(doc.services.caddy.environment.CADDY_ADMIN_PORT, "9019");
		assert.strictEqual(doc.services["control-plane"].environment.SRV0_PORT, "9080");
		assert.strictEqual(doc.services["control-plane"].environment.SRV1_PORT, "9081");
		assert.strictEqual(doc.services["control-plane"].environment.SRV2_PORT, "9082");
		assert.strictEqual(
			doc.services["control-plane"].environment.CADDY_ADMIN_URL,
			"http://caddy:9019",
		);
	});

	it("sets SPA_PROXY_URL when configured", () => {
		const config = makeConfig({
			spa: { root: "", proxyUrl: "http://localhost:5173" },
		});
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.config.json",
			configPath: "/home/user/rockpool/rockpool.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.strictEqual(
			doc.services["control-plane"].environment.SPA_PROXY_URL,
			"http://localhost:5173",
		);
	});

	it("sets empty SPA_PROXY_URL when not configured", () => {
		const config = makeConfig();
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.config.json",
			configPath: "/home/user/rockpool/rockpool.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.strictEqual(doc.services["control-plane"].environment.SPA_PROXY_URL, "");
	});

	it("uses the correct config file name in control-plane environment", () => {
		const config = makeConfig();
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.test.config.json",
			configPath: "/home/user/rockpool/rockpool.test.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.strictEqual(
			doc.services["control-plane"].environment.ROCKPOOL_CONFIG,
			"/app/rockpool.test.config.json",
		);
	});

	it("mounts the project root correctly", () => {
		const config = makeConfig();
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.config.json",
			configPath: "/home/user/rockpool/rockpool.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.ok(doc.services["control-plane"].volumes.includes("/home/user/rockpool:/app"));
		assert.ok(
			doc.services.caddy.volumes.includes("/home/user/rockpool/Caddyfile:/etc/caddy/Caddyfile:ro"),
		);
		assert.ok(
			doc.services.elasticmq.volumes.includes(
				"/home/user/rockpool/elasticmq.conf:/opt/elasticmq.conf:ro",
			),
		);
	});

	it("mounts config file into the container", () => {
		const config = makeConfig();
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/.rockpool",
			configFileName: "rockpool.config.json",
			configPath: "/home/user/myproject/rockpool.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.ok(
			doc.services["control-plane"].volumes.includes(
				"/home/user/myproject/rockpool.config.json:/app/rockpool.config.json:ro",
			),
		);
		assert.strictEqual(
			doc.services["control-plane"].environment.ROCKPOOL_CONFIG,
			"/app/rockpool.config.json",
		);
	});

	it("uses the specified podman socket", () => {
		const config = makeConfig();
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.config.json",
			podmanSocket: "/run/user/1000/podman/podman.sock",
		});

		const doc = parse(yaml);
		assert.ok(
			doc.services["control-plane"].volumes.includes(
				"/run/user/1000/podman/podman.sock:/run/podman.sock",
			),
		);
	});

	it("defines all required volumes", () => {
		const config = makeConfig();
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.config.json",
			configPath: "/home/user/rockpool/rockpool.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.ok("caddy-data" in doc.volumes);
		assert.ok("caddy-config" in doc.volumes);
		assert.ok("rockpool-data" in doc.volumes);
		assert.ok("node-modules" in doc.volumes);
		assert.deepStrictEqual(doc.volumes["node-modules"], { name: "rockpool-node-modules" });
	});

	it("exposes elasticmq port to host", () => {
		const config = makeConfig();
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.config.json",
			configPath: "/home/user/rockpool/rockpool.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.deepStrictEqual(doc.services.elasticmq.ports, ["9324:9324"]);
	});

	it("sets control-plane build path relative to project root", () => {
		const config = makeConfig();
		const yaml = generateCompose({
			config,
			projectRoot: "/opt/rockpool",
			configFileName: "rockpool.config.json",
			configPath: "/opt/rockpool/rockpool.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.strictEqual(doc.services["control-plane"].build, "/opt/rockpool/images/control-plane");
	});
});
