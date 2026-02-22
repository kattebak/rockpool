export interface ServerConfig {
	port: number;
	dbPath: string;
	caddyAdminUrl: string;
	queueEndpoint: string;
	queueUrl: string;
	platform: "darwin" | "linux";
}

export function loadConfig(): ServerConfig {
	return {
		port: Number.parseInt(process.env.PORT ?? "7163", 10),
		dbPath: process.env.DB_PATH ?? "tidepool.db",
		caddyAdminUrl: process.env.CADDY_ADMIN_URL ?? "http://localhost:2019",
		queueEndpoint: process.env.QUEUE_ENDPOINT ?? "http://localhost:9324",
		queueUrl: process.env.QUEUE_URL ?? "http://localhost:9324/000000000000/workspace-jobs",
		platform: (process.env.PLATFORM ?? process.platform) as "darwin" | "linux",
	};
}
