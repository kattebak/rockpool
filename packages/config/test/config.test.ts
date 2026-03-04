import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadConfig, RockpoolConfigSchema } from "../src/index.ts";

function writeTempConfig(dir: string, data: unknown): string {
	const path = join(dir, "config.json");
	writeFileSync(path, JSON.stringify(data));
	return path;
}

describe("RockpoolConfigSchema", () => {
	it("parses a minimal config with defaults", () => {
		const result = RockpoolConfigSchema.parse({
			auth: {
				mode: "basic",
				basic: { username: "admin", password: "admin" },
			},
		});

		assert.equal(result.logLevel, "info");
		assert.equal(result.runtime, "podman");
		assert.equal(result.server.port, 7163);
		assert.equal(result.server.secureCookies, false);
		assert.equal(result.caddy.adminUrl, "http://localhost:2019");
		assert.equal(result.caddy.srv0Port, 8080);
		assert.equal(result.caddy.srv1Port, 8081);
		assert.equal(result.caddy.srv2Port, 8082);
		assert.equal(result.db.path, "rockpool.db");
		assert.equal(result.queue.endpoint, "http://localhost:9324");
		assert.equal(result.queue.queueUrl, "http://localhost:9324/000000000000/workspace-jobs");
		assert.equal(result.container.hostAddress, "host.containers.internal");
		assert.equal(result.urls.dashboard, "http://localhost:8080");
		assert.equal(result.urls.api, "http://localhost:8080/api");
		assert.equal(result.urls.ide, "http://localhost:8081");
		assert.equal(result.urls.preview, "http://localhost:8082");
	});

	it("parses a full config with all fields", () => {
		const result = RockpoolConfigSchema.parse({
			logLevel: "debug",
			runtime: "stub",
			server: { port: 9163, secureCookies: true },
			caddy: {
				adminUrl: "http://localhost:9019",
				adminPort: 9019,
				srv0Port: 9080,
				srv1Port: 9081,
				srv2Port: 9082,
			},
			auth: {
				mode: "github",
				github: {
					clientId: "abc",
					clientSecret: "def",
					callbackUrl: "http://localhost:9080/api/auth/callback",
					sessionMaxAgeMs: 3_600_000,
				},
			},
			db: { path: "/tmp/test.db" },
			queue: {
				endpoint: "http://localhost:9424",
				queueUrl: "http://localhost:9424/000000000000/workspace-jobs",
			},
			container: { hostAddress: "10.0.0.1" },
			spa: { root: "packages/client/dist", proxyUrl: "" },
			urls: {
				dashboard: "http://localhost:9080",
				api: "http://localhost:9080/api",
				ide: "http://localhost:9081",
				preview: "http://localhost:9082",
			},
		});

		assert.equal(result.logLevel, "debug");
		assert.equal(result.runtime, "stub");
		assert.equal(result.server.port, 9163);
		assert.equal(result.server.secureCookies, true);
		assert.equal(result.caddy.srv0Port, 9080);
		assert.equal(result.auth.mode, "github");
		assert.equal(result.auth.github?.clientId, "abc");
		assert.equal(result.db.path, "/tmp/test.db");
		assert.equal(result.container.hostAddress, "10.0.0.1");
	});

	it("rejects missing auth section", () => {
		assert.throws(() => {
			RockpoolConfigSchema.parse({});
		});
	});

	it("rejects basic mode without basic credentials", () => {
		assert.throws(() => {
			RockpoolConfigSchema.parse({
				auth: { mode: "basic" },
			});
		});
	});

	it("rejects github mode without github credentials", () => {
		assert.throws(() => {
			RockpoolConfigSchema.parse({
				auth: { mode: "github" },
			});
		});
	});

	it("rejects invalid port number", () => {
		assert.throws(() => {
			RockpoolConfigSchema.parse({
				auth: {
					mode: "basic",
					basic: { username: "admin", password: "admin" },
				},
				server: { port: 0 },
			});
		});

		assert.throws(() => {
			RockpoolConfigSchema.parse({
				auth: {
					mode: "basic",
					basic: { username: "admin", password: "admin" },
				},
				server: { port: 99999 },
			});
		});
	});

	it("rejects invalid URL", () => {
		assert.throws(() => {
			RockpoolConfigSchema.parse({
				auth: {
					mode: "basic",
					basic: { username: "admin", password: "admin" },
				},
				caddy: { adminUrl: "not-a-url" },
			});
		});
	});
});

describe("loadConfig", () => {
	let tempDir: string;

	before(() => {
		tempDir = mkdtempSync(join(tmpdir(), "rockpool-config-test-"));
	});

	after(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("loads and validates a config file", () => {
		const configPath = writeTempConfig(tempDir, {
			auth: {
				mode: "basic",
				basic: { username: "test", password: "test" },
			},
		});

		const config = loadConfig(configPath);
		assert.equal(config.auth.mode, "basic");
		assert.equal(config.auth.basic?.username, "test");
		assert.equal(config.server.port, 7163);
	});

	it("throws on missing config file", () => {
		assert.throws(() => {
			loadConfig("/nonexistent/path/config.json");
		});
	});

	it("throws on malformed JSON", () => {
		const path = join(tempDir, "bad.json");
		writeFileSync(path, "{not valid json");
		assert.throws(() => {
			loadConfig(path);
		});
	});

	it("throws on invalid config data", () => {
		const configPath = writeTempConfig(tempDir, { server: { port: -1 } });
		assert.throws(() => {
			loadConfig(configPath);
		});
	});

	it("respects ROCKPOOL_CONFIG env var", () => {
		const configPath = writeTempConfig(tempDir, {
			auth: {
				mode: "basic",
				basic: { username: "env", password: "env" },
			},
		});

		const original = process.env.ROCKPOOL_CONFIG;
		process.env.ROCKPOOL_CONFIG = configPath;
		try {
			const config = loadConfig();
			assert.equal(config.auth.basic?.username, "env");
		} finally {
			if (original === undefined) {
				delete process.env.ROCKPOOL_CONFIG;
			} else {
				process.env.ROCKPOOL_CONFIG = original;
			}
		}
	});

	it("throws when no config path is available", () => {
		const original = process.env.ROCKPOOL_CONFIG;
		delete process.env.ROCKPOOL_CONFIG;
		try {
			assert.throws(() => {
				loadConfig();
			}, /No config file specified/);
		} finally {
			if (original !== undefined) {
				process.env.ROCKPOOL_CONFIG = original;
			}
		}
	});
});
