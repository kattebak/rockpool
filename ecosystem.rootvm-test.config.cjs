// Root VM E2E test config: runs inside the VM at /mnt/rockpool/ with stub runtime.
// Same structure as ecosystem.test.config.cjs but uses rootvm-test.env.
// PM2 is started over SSH from the host: npm run ssh:vm -- 'cd /mnt/rockpool && npx pm2 start ecosystem.rootvm-test.config.cjs'

module.exports = {
	apps: [
		{
			name: "rootvm-test-elasticmq",
			script: "npm-scripts/setup-elasticmq.sh",
			args: "test",
			interpreter: "bash",
			autorestart: true,
			max_restarts: 3,
			restart_delay: 2000,
		},
		{
			name: "rootvm-test-caddy",
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
			name: "rootvm-test-server",
			script: "packages/server/src/index.ts",
			interpreter: "node",
			interpreter_args: "--experimental-strip-types --env-file=rootvm-test.env",
			env: {
				RUNTIME: "stub",
			},
			autorestart: true,
			max_restarts: 10,
			restart_delay: 1000,
		},
		{
			name: "rootvm-test-worker",
			script: "packages/worker/src/main.ts",
			interpreter: "node",
			interpreter_args: "--experimental-strip-types --env-file=rootvm-test.env",
			env: {
				RUNTIME: "stub",
			},
			autorestart: true,
			max_restarts: 10,
			restart_delay: 2000,
		},
	],
};
