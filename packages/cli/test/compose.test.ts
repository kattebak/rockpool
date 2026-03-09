import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RockpoolConfig } from "@rockpool/config";
import { parse } from "yaml";
import { deriveUrls, generateCompose } from "../src/compose.ts";

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

	it("includes cloudflared service when tunnel is configured", () => {
		const config = makeConfig({
			tunnel: { domain: "rockpool.example.com", token: "eyJhIjoiNDk..." },
		});
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.config.json",
			configPath: "/home/user/rockpool/rockpool.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.ok(doc.services.cloudflared);
		assert.strictEqual(doc.services.cloudflared.image, "docker.io/cloudflare/cloudflared:latest");
		assert.strictEqual(doc.services.cloudflared.command, "tunnel --no-autoupdate run");
		assert.strictEqual(doc.services.cloudflared.restart, "unless-stopped");
	});

	it("sets TUNNEL_TOKEN environment on cloudflared service", () => {
		const config = makeConfig({
			tunnel: { domain: "rockpool.example.com", token: "my-tunnel-token" },
		});
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.config.json",
			configPath: "/home/user/rockpool/rockpool.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.strictEqual(doc.services.cloudflared.environment.TUNNEL_TOKEN, "my-tunnel-token");
	});

	it("cloudflared depends on caddy", () => {
		const config = makeConfig({
			tunnel: { domain: "rockpool.example.com", token: "eyJhIjoiNDk..." },
		});
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.config.json",
			configPath: "/home/user/rockpool/rockpool.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.deepStrictEqual(doc.services.cloudflared.depends_on, ["caddy"]);
	});

	it("omits cloudflared when no tunnel config", () => {
		const config = makeConfig();
		const yaml = generateCompose({
			config,
			projectRoot: "/home/user/rockpool",
			configFileName: "rockpool.config.json",
			configPath: "/home/user/rockpool/rockpool.config.json",
			podmanSocket: "/var/run/docker.sock",
		});

		const doc = parse(yaml);
		assert.strictEqual(doc.services.cloudflared, undefined);
	});
});

describe("deriveUrls", () => {
	it("derives URLs from tunnel domain when urls absent", () => {
		const config = makeConfig({
			tunnel: { domain: "rockpool.example.com", token: "tok" },
		});
		const urls = deriveUrls(config);
		assert.deepStrictEqual(urls, {
			ide: "https://ide.rockpool.example.com",
			preview: "https://preview.rockpool.example.com",
		});
	});

	it("returns explicit urls when set", () => {
		const config = makeConfig({
			urls: {
				ide: "https://custom-ide.example.com",
				preview: "https://custom-preview.example.com",
			},
			tunnel: { domain: "rockpool.example.com", token: "tok" },
		});
		const urls = deriveUrls(config);
		assert.deepStrictEqual(urls, {
			ide: "https://custom-ide.example.com",
			preview: "https://custom-preview.example.com",
		});
	});

	it("returns undefined when no tunnel and no urls", () => {
		const config = makeConfig();
		const urls = deriveUrls(config);
		assert.strictEqual(urls, undefined);
	});
});
