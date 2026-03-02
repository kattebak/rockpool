// Podman E2E test config: runs directly on a Linux host with Podman runtime.
// Same structure as ecosystem.test.config.cjs but uses podman-test.env and RUNTIME=podman.

module.exports = {
	apps: [
		{
			name: "podman-test-elasticmq",
			script: "npm-scripts/setup-elasticmq.sh",
			args: "test",
			interpreter: "bash",
			autorestart: true,
			max_restarts: 3,
			restart_delay: 2000,
		},
		{
			name: "podman-test-caddy",
			script: "caddy",
			args: "run",
			interpreter: "none",
			env: {
				CADDY_ADMIN: "localhost:9019",
			},
			autorestart: true,
			max_restarts: 3,
			restart_delay: 2000,
		},
		{
			name: "podman-test-server",
			script: "packages/server/src/index.ts",
			interpreter: "node",
			interpreter_args: "--experimental-strip-types --env-file=podman-test.env",
			env: {
				RUNTIME: "podman",
			},
			autorestart: true,
			max_restarts: 10,
			restart_delay: 1000,
		},
		{
			name: "podman-test-worker",
			script: "packages/worker/src/main.ts",
			interpreter: "node",
			interpreter_args: "--experimental-strip-types --env-file=podman-test.env",
			env: {
				RUNTIME: "podman",
			},
			autorestart: true,
			max_restarts: 10,
			restart_delay: 2000,
		},
	],
};
