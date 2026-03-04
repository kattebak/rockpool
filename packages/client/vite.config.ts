import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const ideUrl = process.env.VITE_IDE_URL ?? "http://localhost:8081";
const previewUrl = process.env.VITE_PREVIEW_URL ?? "http://localhost:8082";
const serverPort = process.env.PORT ?? "7163";

export default defineConfig({
	root: __dirname,
	plugins: [react(), tailwindcss()],
	base: "/app/",
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
		},
	},
	define: {
		__IDE_URL__: JSON.stringify(ideUrl),
		__PREVIEW_URL__: JSON.stringify(previewUrl),
	},
	server: {
		port: 5173,
		allowedHosts: true,
		proxy: {
			"/api": {
				target: `http://localhost:${serverPort}`,
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
