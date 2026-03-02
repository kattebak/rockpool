// Root VM development config: runs inside the VM at /mnt/rockpool/ with Podman runtime.
// Same structure as ecosystem.caddy.config.cjs but tailored for the Root VM environment.
// Started via: npm run start:rootvm (which boots the VM and starts PM2 over SSH)

module.exports = {
	apps: [
		{
			name: "rootvm-elasticmq",
			script: "npm-scripts/setup-elasticmq.sh",
			interpreter: "bash",
			autorestart: true,
			max_restarts: 3,
			restart_delay: 2000,
		},
		{
			name: "rootvm-caddy",
			script: "caddy",
			args: "run",
			interpreter: "none",
			autorestart: true,
			max_restarts: 3,
			restart_delay: 2000,
		},
		{
			name: "rootvm-server",
			script: "packages/server/src/index.ts",
			interpreter: "node",
			interpreter_args:
				"--experimental-strip-types --env-file=development.env",
			env: {
				RUNTIME: "podman",
			},
			watch: ["packages/server/src"],
			watch_delay: 2000,
			ignore_watch: ["node_modules", "*.test.ts"],
			autorestart: true,
			max_restarts: 10,
			restart_delay: 1000,
		},
		{
			name: "rootvm-worker",
			script: "packages/worker/src/main.ts",
			interpreter: "node",
			interpreter_args:
				"--experimental-strip-types --env-file=development.env",
			env: {
				RUNTIME: "podman",
			},
			autorestart: true,
			max_restarts: 10,
			restart_delay: 2000,
		},
		{
			name: "rootvm-client",
			script: "npm",
			args: "run dev -w packages/client",
			cwd: __dirname,
			autorestart: true,
			max_restarts: 5,
			restart_delay: 1000,
		},
	],
};
