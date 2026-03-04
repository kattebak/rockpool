import { defineConfig } from "@playwright/test";

const srv0Port = process.env.SRV0_PORT ?? "8080";
const BASE_URL = `http://localhost:${srv0Port}`;

export default defineConfig({
	testDir: "tests",
	workers: 1,
	fullyParallel: false,
	retries: 0,
	timeout: 5 * 60 * 1000,
	expect: {
		timeout: 30_000,
	},
	use: {
		baseURL: BASE_URL,
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
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
