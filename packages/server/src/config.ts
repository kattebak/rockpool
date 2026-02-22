export interface ServerConfig {
	port: number;
	srv1Port: number;
	dbPath: string;
	caddyAdminUrl: string;
	caddyUsername: string;
	caddyPassword: string;
	spaRoot: string;
	queueEndpoint: string;
	queueUrl: string;
	platform: "darwin" | "linux";
	sshKeyPath: string;
}

export function loadConfig(): ServerConfig {
	return {
		port: Number.parseInt(process.env.PORT ?? "7163", 10),
		srv1Port: Number.parseInt(process.env.SRV1_PORT ?? "8081", 10),
		dbPath: process.env.DB_PATH ?? "tidepool.db",
		caddyAdminUrl: process.env.CADDY_ADMIN_URL ?? "http://localhost:2019",
		caddyUsername: process.env.CADDY_USERNAME ?? "",
		caddyPassword: process.env.CADDY_PASSWORD ?? "",
		spaRoot: process.env.SPA_ROOT ?? "",
		queueEndpoint: process.env.QUEUE_ENDPOINT ?? "http://localhost:9324",
		queueUrl: process.env.QUEUE_URL ?? "http://localhost:9324/000000000000/workspace-jobs",
		platform: (process.env.PLATFORM ?? process.platform) as "darwin" | "linux",
		sshKeyPath: process.env.SSH_KEY_PATH ?? "images/ssh/tidepool_ed25519",
	};
}
