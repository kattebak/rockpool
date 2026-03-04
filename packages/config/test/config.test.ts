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
		assert.equal(result.server.secureCookies, false);
		assert.equal(result.spa.root, "");
		assert.equal(result.spa.proxyUrl, "");
	});

	it("parses a full config with all fields", () => {
		const result = RockpoolConfigSchema.parse({
			logLevel: "debug",
			runtime: "stub",
			server: { secureCookies: true },
			auth: {
				mode: "github",
				github: {
					clientId: "abc",
					clientSecret: "def",
					callbackUrl: "http://localhost:9080/api/auth/callback",
					sessionMaxAgeMs: 3_600_000,
				},
			},
			spa: { root: "packages/client/dist", proxyUrl: "" },
		});

		assert.equal(result.logLevel, "debug");
		assert.equal(result.runtime, "stub");
		assert.equal(result.server.secureCookies, true);
		assert.equal(result.auth.mode, "github");
		assert.equal(result.auth.github?.clientId, "abc");
		assert.equal(result.spa.root, "packages/client/dist");
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

	it("rejects invalid log level", () => {
		assert.throws(() => {
			RockpoolConfigSchema.parse({
				auth: {
					mode: "basic",
					basic: { username: "admin", password: "admin" },
				},
				logLevel: "verbose",
			});
		});
	});

	it("rejects invalid runtime", () => {
		assert.throws(() => {
			RockpoolConfigSchema.parse({
				auth: {
					mode: "basic",
					basic: { username: "admin", password: "admin" },
				},
				runtime: "docker",
			});
		});
	});

	it("parses config with urls section", () => {
		const result = RockpoolConfigSchema.parse({
			auth: {
				mode: "basic",
				basic: { username: "admin", password: "admin" },
			},
			urls: {
				ide: "https://ide.rockpool.example.com",
				preview: "https://preview.rockpool.example.com",
			},
		});

		assert.equal(result.urls?.ide, "https://ide.rockpool.example.com");
		assert.equal(result.urls?.preview, "https://preview.rockpool.example.com");
	});

	it("parses config without urls section (backward compatible)", () => {
		const result = RockpoolConfigSchema.parse({
			auth: {
				mode: "basic",
				basic: { username: "admin", password: "admin" },
			},
		});

		assert.equal(result.urls, undefined);
	});

	it("rejects malformed ide URL in urls section", () => {
		assert.throws(() => {
			RockpoolConfigSchema.parse({
				auth: {
					mode: "basic",
					basic: { username: "admin", password: "admin" },
				},
				urls: {
					ide: "not-a-url",
					preview: "https://preview.rockpool.example.com",
				},
			});
		});
	});

	it("rejects malformed preview URL in urls section", () => {
		assert.throws(() => {
			RockpoolConfigSchema.parse({
				auth: {
					mode: "basic",
					basic: { username: "admin", password: "admin" },
				},
				urls: {
					ide: "https://ide.rockpool.example.com",
					preview: "not-a-url",
				},
			});
		});
	});

	it("rejects urls section with missing fields", () => {
		assert.throws(() => {
			RockpoolConfigSchema.parse({
				auth: {
					mode: "basic",
					basic: { username: "admin", password: "admin" },
				},
				urls: {
					ide: "https://ide.rockpool.example.com",
				},
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
		assert.equal(config.server.secureCookies, false);
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
		const configPath = writeTempConfig(tempDir, { logLevel: "invalid" });
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
