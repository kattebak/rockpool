import { defineConfig } from "@playwright/test";

const profile = process.env.E2E_PROFILE ?? "development";
const isCi = profile === "ci";

const BASE_URL =
	process.env.DASHBOARD_URL ?? (isCi ? "http://localhost:9080" : "http://localhost:8080");

export default defineConfig({
	testDir: "tests",
	workers: 1,
	fullyParallel: false,
	retries: isCi ? 1 : 0,
	timeout: isCi ? 30_000 : 5 * 60 * 1000,
	expect: {
		timeout: isCi ? 10_000 : 30_000,
	},
	use: {
		baseURL: BASE_URL,
		actionTimeout: isCi ? 5_000 : 15_000,
		navigationTimeout: isCi ? 10_000 : 30_000,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},

	projects: [
		{
			name: "chromium",
			use: { browserName: "chromium" },
		},
	],

	...(isCi && {
		globalSetup: "./global-setup.ts",
		globalTeardown: "./global-teardown.ts",
	}),
});
