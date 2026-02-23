import { defineConfig } from "@playwright/test";

const profile = process.env.E2E_PROFILE ?? "development";
const isTest = profile === "test";

const BASE_URL =
	process.env.DASHBOARD_URL ?? (isTest ? "http://localhost:9080" : "http://localhost:8080");

export default defineConfig({
	testDir: "tests",
	workers: 1,
	fullyParallel: false,
	retries: isTest ? 1 : 0,
	timeout: isTest ? 30_000 : 5 * 60 * 1000,
	expect: {
		timeout: isTest ? 10_000 : 30_000,
	},
	use: {
		baseURL: BASE_URL,
		actionTimeout: isTest ? 5_000 : 15_000,
		navigationTimeout: isTest ? 10_000 : 30_000,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},

	...(isTest && {
		projects: [
			{
				name: "chromium",
				use: { browserName: "chromium" },
			},
		],
	}),

	...(isTest && {
		globalSetup: "./global-setup.ts",
		globalTeardown: "./global-teardown.ts",
	}),
});
