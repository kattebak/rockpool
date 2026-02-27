import { defineConfig } from "@playwright/test";

const isStub = process.env.RUNTIME === "stub";

const BASE_URL = process.env.DASHBOARD_URL ?? "http://localhost:8080";

export default defineConfig({
	testDir: "tests",
	workers: 1,
	fullyParallel: false,
	retries: isStub ? 1 : 0,
	timeout: isStub ? 30_000 : 5 * 60 * 1000,
	expect: {
		timeout: isStub ? 10_000 : 30_000,
	},
	use: {
		baseURL: BASE_URL,
		actionTimeout: isStub ? 5_000 : 15_000,
		navigationTimeout: isStub ? 10_000 : 30_000,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},

	projects: [
		{
			name: "chromium",
			use: { browserName: "chromium" },
		},
	],

	globalSetup: "./global-setup.ts",
	globalTeardown: "./global-teardown.ts",
});
