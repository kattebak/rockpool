// Caddy dev config: Caddy on :8080 proxies /app to Vite dev server on :5173
// Server env vars loaded via node --env-file=development.env (see packages/server/package.json)
module.exports = {
	apps: [
		{
			name: "elasticmq",
			script: "npm-scripts/setup-elasticmq.sh",
			interpreter: "bash",
			autorestart: true,
			max_restarts: 3,
			restart_delay: 2000,
		},
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
			watch: ["packages/server/src"],
			watch_delay: 1000,
			ignore_watch: ["node_modules", "*.test.ts"],
			autorestart: true,
			max_restarts: 10,
			restart_delay: 1000,
		},
		{
			name: "worker",
			script: "npm",
			args: "run start -w packages/worker",
			cwd: __dirname,
			autorestart: true,
			max_restarts: 10,
			restart_delay: 2000,
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
