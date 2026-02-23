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

function buildSpaProxyRoute(spaProxyUrl: string): Record<string, unknown> {
	const upstream = new URL(spaProxyUrl);
	const dial = `${upstream.hostname}:${upstream.port || "5173"}`;

	return {
		"@id": "spa-proxy",
		match: [{ path: ["/app", "/app/*"] }],
		handle: [
			{
				handler: "reverse_proxy",
				upstreams: [{ dial }],
			},
		],
		terminal: true,
	};
}

function buildWorkspaceRedirect(srv1Port: number): Record<string, unknown> {
	return {
		"@id": "workspace-redirect",
		match: [{ path: ["/workspace/*"] }],
		handle: [
			{
				handler: "static_response",
				status_code: 302,
				headers: {
					Location: [
						`{http.request.scheme}://{http.request.hostname}:${srv1Port}{http.request.uri}`,
					],
				},
			},
		],
		terminal: true,
	};
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

	if (options.spaProxyUrl) {
		srv0Routes.push(buildSpaProxyRoute(options.spaProxyUrl));
	} else if (options.spaRoot) {
		srv0Routes.push(...buildSpaRoutes(options.spaRoot));
	}

	if (options.srv1Port) {
		srv0Routes.push(buildWorkspaceRedirect(options.srv1Port));
	}

	if (options.controlPlaneUrl || options.spaRoot || options.spaProxyUrl) {
		srv0Routes.push(buildRootRedirect());
	}

	const srv1Routes: unknown[] = [];

	if (options.auth) {
		srv1Routes.push({
			"@id": "srv1-auth-gate",
			match: [{ path: ["/workspace/*"] }],
			handle: [buildBasicAuthHandler(options.auth)],
		});
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
						routes: srv1Routes,
					},
				},
			},
		},
	};
}
