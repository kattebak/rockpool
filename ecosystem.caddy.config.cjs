const path = require("node:path");

module.exports = {
	apps: [
		{
			name: "caddy",
			script: "caddy",
			args: "run --config '' --adapter ''",
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
				SPA_ROOT: path.join(__dirname, "build", "client"),
				SSH_KEY_PATH: path.join(__dirname, "images", "ssh", "tidepool_ed25519"),
			},
			watch: ["packages/server/src"],
			watch_delay: 1000,
			ignore_watch: ["node_modules", "*.test.ts"],
			autorestart: true,
			max_restarts: 10,
			restart_delay: 1000,
		},
	],
};
