import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	base: "/app/",
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: "http://localhost:7163",
				changeOrigin: true,
			},
		},
	},
test: {
		environment: "jsdom",
		globals: true,
		passWithNoTests: true,
	},
});
