import { resolve } from "node:path";

export interface ServerConfig {
	port: number;
	srv0Port: number;
	srv1Port: number;
	dbPath: string;
	caddyAdminUrl: string;
	caddyUsername: string;
	caddyPassword: string;
	spaRoot: string;
	spaProxyUrl: string;
	queueEndpoint: string;
	queueUrl: string;
	platform: "darwin" | "linux";
	sshKeyPath: string;
}

export function loadConfig(): ServerConfig {
	const projectRoot = new URL("../../..", import.meta.url).pathname;

	return {
		port: Number.parseInt(process.env.PORT ?? "7163", 10),
		srv0Port: Number.parseInt(process.env.SRV0_PORT ?? "8080", 10),
		srv1Port: Number.parseInt(process.env.SRV1_PORT ?? "8081", 10),
		dbPath: resolve(projectRoot, process.env.DB_PATH ?? "rockpool.db"),
		caddyAdminUrl: process.env.CADDY_ADMIN_URL ?? "http://localhost:2019",
		caddyUsername: process.env.CADDY_USERNAME ?? "",
		caddyPassword: process.env.CADDY_PASSWORD ?? "",
		spaRoot: process.env.SPA_ROOT ?? "",
		spaProxyUrl: process.env.SPA_PROXY_URL ?? "",
		queueEndpoint: process.env.QUEUE_ENDPOINT ?? "http://localhost:9324",
		queueUrl: process.env.QUEUE_URL ?? "http://localhost:9324/000000000000/workspace-jobs",
		platform: (process.env.PLATFORM ?? process.platform) as "darwin" | "linux",
		sshKeyPath: resolve(projectRoot, process.env.SSH_KEY_PATH ?? "images/ssh/rockpool_ed25519"),
	};
}
