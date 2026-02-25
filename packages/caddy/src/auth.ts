import bcrypt from "bcryptjs";
import type { AuthMode, BasicAuthCredentials, BootstrapOptions } from "./types.ts";

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plaintext: string): Promise<string> {
	return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

function buildBasicAuthSubroute(credentials: BasicAuthCredentials): Record<string, unknown> {
	return {
		handler: "subroute",
		routes: [
			{
				handle: [
					{
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
					},
				],
			},
		],
	};
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

export function buildForwardAuthHandler(
	controlPlaneDial: string,
	srv0Port: number,
): Record<string, unknown> {
	return {
		handler: "reverse_proxy",
		upstreams: [{ dial: controlPlaneDial }],
		rewrite: { method: "GET", uri: "/api/auth/verify" },
		headers: {
			request: {
				set: {
					"X-Forwarded-Method": ["{http.request.method}"],
					"X-Forwarded-Uri": ["{http.request.uri}"],
					"X-Forwarded-Host": ["{http.request.host}"],
					"X-Forwarded-Proto": ["{http.request.scheme}"],
				},
			},
		},
		handle_response: [
			{
				match: { status_code: [2] },
				routes: [
					{
						handle: [
							{
								handler: "headers",
								request: {
									set: {
										"X-Authenticated-User": ["{http.reverse_proxy.header.X-Authenticated-User}"],
									},
								},
							},
						],
					},
				],
			},
			{
				match: { status_code: [401] },
				routes: [
					{
						handle: [
							{
								handler: "static_response",
								status_code: 302,
								headers: {
									Location: [
										`http://{http.request.host}:${srv0Port}/api/auth/github?return_to={http.request.scheme}://{http.request.hostport}{http.request.uri}`,
									],
								},
							},
						],
					},
				],
			},
		],
	};
}

export function buildAuthHandler(authMode: AuthMode): Record<string, unknown> {
	if (authMode.mode === "basic") {
		return buildBasicAuthSubroute(authMode.credentials);
	}
	return buildForwardAuthHandler(authMode.controlPlaneDial, authMode.srv0Port);
}

function buildSrv0AuthRoutes(credentials: BasicAuthCredentials): unknown[] {
	return [
		{
			"@id": "auth-gate",
			match: [{ path: ["/api/*", "/app/*"] }],
			handle: [buildBasicAuthHandler(credentials)],
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
					Location: [`{http.request.scheme}://{http.request.host}:${srv1Port}{http.request.uri}`],
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

function buildAuthGate(id: string, paths: string[], authMode: AuthMode): Record<string, unknown> {
	if (authMode.mode === "basic") {
		return {
			"@id": id,
			match: [{ path: paths }],
			handle: [buildBasicAuthHandler(authMode.credentials)],
		};
	}
	return {
		"@id": id,
		match: [{ path: paths }],
		handle: [buildForwardAuthHandler(authMode.controlPlaneDial, authMode.srv0Port)],
	};
}

export function buildBootstrapConfig(options: BootstrapOptions = {}): Record<string, unknown> {
	const srv0Routes: unknown[] = [
		{
			"@id": "health-check",
			match: [{ path: ["/api/health"] }],
			handle: [{ handler: "static_response", status_code: 200, body: "OK" }],
			terminal: true,
		},
	];

	if (options.authMode?.mode === "basic") {
		srv0Routes.push(...buildSrv0AuthRoutes(options.authMode.credentials));
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
	const srv2Routes: unknown[] = [];

	if (options.authMode) {
		srv1Routes.push(buildAuthGate("srv1-auth-gate", ["/workspace/*"], options.authMode));
		srv2Routes.push(buildAuthGate("srv2-auth-gate", ["/workspace/*"], options.authMode));
	}

	return {
		apps: {
			http: {
				servers: {
					srv0: {
						listen: [`:${options.srv0Port ?? 8080}`],
						routes: srv0Routes,
					},
					srv1: {
						listen: [`:${options.srv1Port ?? 8081}`],
						routes: srv1Routes,
					},
					srv2: {
						listen: [`:${options.srv2Port ?? 8082}`],
						routes: srv2Routes,
					},
				},
			},
		},
	};
}
