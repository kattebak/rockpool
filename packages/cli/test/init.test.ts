import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { RockpoolConfigSchema } from "@rockpool/config";

const BIN = resolve(import.meta.dirname, "../src/bin.ts");
const NODE_FLAGS = "--experimental-strip-types --no-warnings";

function runInit(flags: string): string {
	return execSync(`node ${NODE_FLAGS} ${BIN} init ${flags}`, {
		encoding: "utf-8",
		cwd: resolve(import.meta.dirname, "../../.."),
	});
}

describe("rockpool init", () => {
	const testOutput = `/tmp/rockpool-init-test-${process.pid}.json`;

	afterEach(() => {
		try {
			unlinkSync(testOutput);
		} catch {}
	});

	it("creates a config file with basic auth via flags", () => {
		runInit(`--auth-mode basic --auth-username admin --auth-password secret -o ${testOutput}`);
		assert.ok(existsSync(testOutput));
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.auth.mode, "basic");
		assert.strictEqual(config.auth.basic.username, "admin");
		assert.strictEqual(config.auth.basic.password, "secret");
	});

	it("uses default ports when not specified", () => {
		runInit(`--auth-mode basic --auth-username admin --auth-password secret -o ${testOutput}`);
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.ports.http, 8080);
		assert.strictEqual(config.ports.ide, 8081);
		assert.strictEqual(config.ports.preview, 8082);
	});

	it("uses custom ports when specified", () => {
		runInit(
			`--auth-mode basic --auth-username admin --auth-password secret --port-http 9080 --port-ide 9081 --port-preview 9082 -o ${testOutput}`,
		);
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.ports.http, 9080);
		assert.strictEqual(config.ports.ide, 9081);
		assert.strictEqual(config.ports.preview, 9082);
	});

	it("includes $schema reference", () => {
		runInit(`--auth-mode basic --auth-username admin --auth-password secret -o ${testOutput}`);
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.$schema, "./packages/config/rockpool.schema.json");
	});

	it("uses default log level and runtime", () => {
		runInit(`--auth-mode basic --auth-username admin --auth-password secret -o ${testOutput}`);
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.logLevel, "info");
		assert.strictEqual(config.runtime, "podman");
	});

	it("includes spa proxy url when specified", () => {
		runInit(
			`--auth-mode basic --auth-username admin --auth-password secret --spa-proxy-url http://localhost:5173 -o ${testOutput}`,
		);
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.spa.proxyUrl, "http://localhost:5173");
	});

	it("omits spa section when proxy url not specified", () => {
		runInit(`--auth-mode basic --auth-username admin --auth-password secret -o ${testOutput}`);
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.spa, undefined);
	});

	it("generates a valid config that passes schema validation", () => {
		runInit(`--auth-mode basic --auth-username admin --auth-password secret -o ${testOutput}`);
		const raw = readFileSync(testOutput, "utf-8");
		const config = JSON.parse(raw);
		const { $schema, ...rest } = config;
		assert.doesNotThrow(() => RockpoolConfigSchema.parse(rest));
	});

	it("creates a config file with github auth via flags", () => {
		runInit(
			`--auth-mode github --auth-client-id my-client-id --auth-client-secret my-secret -o ${testOutput}`,
		);
		assert.ok(existsSync(testOutput));
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.auth.mode, "github");
		assert.strictEqual(config.auth.github.clientId, "my-client-id");
		assert.strictEqual(config.auth.github.clientSecret, "my-secret");
		assert.strictEqual(config.auth.github.callbackUrl, "http://localhost:8080/api/auth/callback");
	});

	it("uses custom callback url for github auth", () => {
		runInit(
			`--auth-mode github --auth-client-id my-client-id --auth-client-secret my-secret --auth-callback-url https://example.com/callback -o ${testOutput}`,
		);
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.auth.github.callbackUrl, "https://example.com/callback");
	});

	it("generates a valid config with github auth that passes schema validation", () => {
		runInit(
			`--auth-mode github --auth-client-id my-client-id --auth-client-secret my-secret -o ${testOutput}`,
		);
		const raw = readFileSync(testOutput, "utf-8");
		const config = JSON.parse(raw);
		const { $schema, ...rest } = config;
		assert.doesNotThrow(() => RockpoolConfigSchema.parse(rest));
	});

	it("creates config with tunnel section when domain and token provided", () => {
		runInit(
			`--auth-mode basic --auth-username admin --auth-password secret --tunnel-domain rockpool.example.com --tunnel-token eyJhIjoiNDk -o ${testOutput}`,
		);
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.tunnel.domain, "rockpool.example.com");
		assert.strictEqual(config.tunnel.token, "eyJhIjoiNDk");
	});

	it("auto-derives tunnel URLs in config", () => {
		runInit(
			`--auth-mode basic --auth-username admin --auth-password secret --tunnel-domain rockpool.example.com --tunnel-token eyJhIjoiNDk -o ${testOutput}`,
		);
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.urls.ide, "https://ide.rockpool.example.com");
		assert.strictEqual(config.urls.preview, "https://preview.rockpool.example.com");
	});

	it("sets secureCookies when tunnel configured", () => {
		runInit(
			`--auth-mode basic --auth-username admin --auth-password secret --tunnel-domain rockpool.example.com --tunnel-token eyJhIjoiNDk -o ${testOutput}`,
		);
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.server.secureCookies, true);
	});

	it("omits tunnel section when only domain provided without token", () => {
		runInit(
			`--auth-mode basic --auth-username admin --auth-password secret --tunnel-domain rockpool.example.com -o ${testOutput}`,
		);
		const config = JSON.parse(readFileSync(testOutput, "utf-8"));
		assert.strictEqual(config.tunnel, undefined);
	});

	it("generates a valid config with tunnel that passes schema validation", () => {
		runInit(
			`--auth-mode basic --auth-username admin --auth-password secret --tunnel-domain rockpool.example.com --tunnel-token eyJhIjoiNDk -o ${testOutput}`,
		);
		const raw = readFileSync(testOutput, "utf-8");
		const config = JSON.parse(raw);
		const { $schema, ...rest } = config;
		assert.doesNotThrow(() => RockpoolConfigSchema.parse(rest));
	});
});
