// Production-like local profile: pre-built client, no file watchers, LAN-accessible.
// Ports: Caddy 59007/10081/10082, API 10163, ElasticMQ 10324, Caddy admin 10019.
// See doc/EDD/021_Production_Profile.md for design details.
const path = require("node:path");
const os = require("node:os");

const isLinux = os.platform() === "linux";
const TART_HOME = process.env.TART_HOME || path.join(__dirname, ".tart");
const FIRECRACKER_BASE_PATH =
	process.env.FIRECRACKER_BASE_PATH || path.join(__dirname, ".firecracker");

const runtimeEnv = isLinux ? { FIRECRACKER_BASE_PATH } : { TART_HOME };

module.exports = {
	apps: [
		{
			name: "prod-elasticmq",
			script: "npm-scripts/setup-elasticmq.sh",
			args: "production",
			interpreter: "bash",
			autorestart: true,
			max_restarts: 3,
			restart_delay: 2000,
		},
		{
			name: "prod-caddy",
			script: "caddy",
			args: "run",
			interpreter: "none",
			env: {
				CADDY_ADMIN: "localhost:10019",
			},
			autorestart: true,
			max_restarts: 3,
			restart_delay: 2000,
		},
		{
			name: "prod-server",
			script: "packages/server/src/index.ts",
			interpreter: "node",
			interpreter_args: "--experimental-strip-types --env-file=production.env",
			env: runtimeEnv,
			autorestart: true,
			max_restarts: 10,
			restart_delay: 1000,
		},
		{
			name: "prod-worker",
			script: "packages/worker/src/main.ts",
			interpreter: "node",
			interpreter_args: "--experimental-strip-types --env-file=production.env",
			env: runtimeEnv,
			autorestart: true,
			max_restarts: 10,
			restart_delay: 2000,
		},
	],
};
