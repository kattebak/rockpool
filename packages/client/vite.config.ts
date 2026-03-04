import { resolve } from "node:path";
import { loadConfig } from "@rockpool/config";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = loadConfig();

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
		__IDE_URL__: JSON.stringify(config.urls.ide),
		__PREVIEW_URL__: JSON.stringify(config.urls.preview),
	},
	server: {
		port: 5173,
		allowedHosts: true,
		proxy: {
			"/api": {
				target: `http://localhost:${config.server.port}`,
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
