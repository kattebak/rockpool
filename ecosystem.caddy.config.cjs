const path = require("node:path");

// Caddy dev config: Caddy on :8080 proxies /app to Vite dev server on :5173
module.exports = {
	apps: [
		{
			name: "caddy",
			script: "caddy",
			args: "run",
			interpreter: "none",
			autorestart: true,
			max_restarts: 3,
			restart_delay: 2000,
		},
		{
			name: "server",
			script: "npm",
			args: "run start -w packages/server",
			cwd: __dirname,
			env: {
				WORKER_INLINE: "true",
				SPA_PROXY_URL: "http://localhost:5173",
				SSH_KEY_PATH: path.join(__dirname, "images", "ssh", "rockpool_ed25519"),
			},
			watch: ["packages/server/src"],
			watch_delay: 1000,
			ignore_watch: ["node_modules", "*.test.ts"],
			autorestart: true,
			max_restarts: 10,
			restart_delay: 1000,
		},
		{
			name: "client",
			script: "npm",
			args: "run dev -w packages/client",
			cwd: __dirname,
			autorestart: true,
			max_restarts: 5,
			restart_delay: 1000,
		},
	],
};
