import { resolve } from "node:path";
import type { AuthConfig } from "@rockpool/auth";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

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
	auth: AuthConfig | null;
	secureCookies: boolean;
}

export function loadConfig(): ServerConfig {
	const projectRoot = new URL("../../..", import.meta.url).pathname;

	const clientId = process.env.GITHUB_OAUTH_CLIENT_ID ?? "";
	const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET ?? "";

	const auth: AuthConfig | null =
		clientId && clientSecret
			? {
					clientId,
					clientSecret,
					callbackUrl:
						process.env.GITHUB_OAUTH_CALLBACK_URL ?? "http://localhost:8080/api/auth/callback",
					sessionMaxAgeMs: Number.parseInt(
						process.env.SESSION_MAX_AGE_MS ?? String(TWENTY_FOUR_HOURS_MS),
						10,
					),
				}
			: null;

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
		auth,
		secureCookies: process.env.SECURE_COOKIES === "true",
	};
}
