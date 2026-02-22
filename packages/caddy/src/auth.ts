import bcrypt from "bcryptjs";
import type { BasicAuthCredentials, BootstrapOptions } from "./types.ts";

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plaintext: string): Promise<string> {
	return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

function buildBasicAuthHandler(credentials: BasicAuthCredentials): Record<string, unknown> {
	return {
		handler: "authentication",
		providers: {
			http_basic: {
				accounts: [
					{
						username: credentials.username,
						password: credentials.passwordHash,
					},
				],
			},
		},
	};
}

function buildAuthRoutes(auth: BasicAuthCredentials): unknown[] {
	return [
		{
			"@id": "health-check",
			match: [{ path: ["/api/health"] }],
			handle: [{ handler: "static_response", status_code: 200, body: "OK" }],
			terminal: true,
		},
		{
			"@id": "auth-gate",
			match: [{ path: ["/api/*", "/app/*"] }],
			handle: [buildBasicAuthHandler(auth)],
		},
	];
}

function buildApiProxyRoute(controlPlaneUrl: string): Record<string, unknown> {
	const upstream = new URL(controlPlaneUrl);
	const host = upstream.hostname === "localhost" ? "127.0.0.1" : upstream.hostname;
	const dial = `${host}:${upstream.port || "7163"}`;

	return {
		"@id": "api-proxy",
		match: [{ path: ["/api/*"] }],
		handle: [
			{
				handler: "reverse_proxy",
				upstreams: [{ dial }],
			},
		],
		terminal: true,
	};
}

function buildSpaRoutes(spaRoot: string): unknown[] {
	return [
		{
			"@id": "spa-assets",
			match: [{ path: ["/app/assets/*"] }],
			handle: [
				{ handler: "rewrite", strip_path_prefix: "/app" },
				{
					handler: "file_server",
					root: spaRoot,
				},
			],
			terminal: true,
		},
		{
			"@id": "spa-fallback",
			match: [{ path: ["/app", "/app/*"] }],
			handle: [
				{
					handler: "rewrite",
					uri: "/index.html",
				},
				{
					handler: "file_server",
					root: spaRoot,
				},
			],
			terminal: true,
		},
	];
}

function buildRootRedirect(): Record<string, unknown> {
	return {
		"@id": "root-redirect",
		match: [{ path: ["/"] }],
		handle: [
			{
				handler: "static_response",
				status_code: 302,
				headers: { Location: ["/app/workspaces"] },
			},
		],
		terminal: true,
	};
}

export function buildBootstrapConfig(options: BootstrapOptions = {}): Record<string, unknown> {
	const srv0Routes: unknown[] = [];

	if (options.auth) {
		srv0Routes.push(...buildAuthRoutes(options.auth));
	}

	if (options.controlPlaneUrl) {
		srv0Routes.push(buildApiProxyRoute(options.controlPlaneUrl));
	}

	if (options.spaRoot) {
		srv0Routes.push(...buildSpaRoutes(options.spaRoot));
	}

	if (options.controlPlaneUrl || options.spaRoot) {
		srv0Routes.push(buildRootRedirect());
	}

	return {
		apps: {
			http: {
				servers: {
					srv0: {
						listen: [":8080"],
						routes: srv0Routes,
					},
					srv1: {
						listen: [":8081"],
						routes: [],
					},
				},
			},
		},
	};
}
