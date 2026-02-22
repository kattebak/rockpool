module.exports = {
	apps: [
		{
			name: "server",
			script: "npm",
			args: "run start -w packages/server",
			cwd: __dirname,
			env: {
				NODE_ENV: "test",
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
