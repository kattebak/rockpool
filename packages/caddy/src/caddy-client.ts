import { buildAuthHandler } from "./auth.ts";
import type { AuthMode, CaddyClientOptions, CaddyRepository, FetchFn } from "./types.ts";

const DEFAULT_ADMIN_URL = "http://localhost:2019";
const SRV1_ROUTES_PATH = "/config/apps/http/servers/srv1/routes";
const SRV2_ROUTES_PATH = "/config/apps/http/servers/srv2/routes";

function workspaceRouteId(name: string): string {
	return `workspace-${name}`;
}

function workspaceRedirectId(name: string): string {
	return `workspace-${name}-redirect`;
}

function portRouteId(workspaceName: string, port: number): string {
	return `workspace-${workspaceName}-port-${port}`;
}

function portRedirectId(workspaceName: string, port: number): string {
	return `workspace-${workspaceName}-port-${port}-redirect`;
}

function toDial(vmIp: string, defaultPort: number): string {
	if (vmIp.includes(":")) return vmIp;
	return `${vmIp}:${defaultPort}`;
}

function buildWorkspaceRedirectRoute(name: string): Record<string, unknown> {
	const pathPrefix = `/workspace/${name}`;
	return {
		"@id": workspaceRedirectId(name),
		match: [{ path: [pathPrefix] }],
		handle: [
			{
				handler: "static_response",
				status_code: 302,
				headers: {
					Location: [`${pathPrefix}/`],
				},
			},
		],
		terminal: true,
	};
}

function buildWorkspaceRoute(
	name: string,
	vmIp: string,
	authMode?: AuthMode,
): Record<string, unknown> {
	const pathPrefix = `/workspace/${name}`;
	const handlers: unknown[] = [];

	if (authMode) {
		handlers.push(buildAuthHandler(authMode));
	}

	handlers.push(
		{ handler: "rewrite", strip_path_prefix: pathPrefix },
		{
			handler: "reverse_proxy",
			upstreams: [{ dial: toDial(vmIp, 8080) }],
			flush_interval: -1,
			stream_timeout: "24h",
			stream_close_delay: "5s",
			headers: {
				request: {
					set: {
						"X-Forwarded-Prefix": [pathPrefix],
					},
				},
			},
		},
	);

	return {
		"@id": workspaceRouteId(name),
		match: [{ path: [`${pathPrefix}/*`] }],
		handle: handlers,
		terminal: true,
	};
}

function buildPortRedirectRoute(workspaceName: string, port: number): Record<string, unknown> {
	const pathPrefix = `/workspace/${workspaceName}/port/${port}`;
	return {
		"@id": portRedirectId(workspaceName, port),
		match: [{ path: [pathPrefix] }],
		handle: [
			{
				handler: "static_response",
				status_code: 302,
				headers: {
					Location: [`${pathPrefix}/`],
				},
			},
		],
		terminal: true,
	};
}

function buildPortRoute(
	workspaceName: string,
	vmIp: string,
	port: number,
	authMode?: AuthMode,
): Record<string, unknown> {
	const pathPrefix = `/workspace/${workspaceName}/port/${port}`;
	const handlers: unknown[] = [];

	if (authMode) {
		handlers.push(buildAuthHandler(authMode));
	}

	handlers.push(
		{ handler: "rewrite", strip_path_prefix: pathPrefix },
		{
			handler: "reverse_proxy",
			upstreams: [{ dial: toDial(vmIp, port) }],
			flush_interval: -1,
			headers: {
				request: {
					set: {
						"X-Forwarded-Prefix": [pathPrefix],
					},
				},
			},
		},
	);

	return {
		"@id": portRouteId(workspaceName, port),
		match: [{ path: [`${pathPrefix}/*`] }],
		handle: handlers,
		terminal: true,
	};
}

async function assertOk(response: Response, context: string): Promise<void> {
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Caddy ${context}: ${response.status} ${body}`);
	}
}

async function deleteById(
	fetchFn: FetchFn,
	adminUrl: string,
	adminHeaders: Record<string, string>,
	id: string,
	context: string,
): Promise<void> {
	const response = await fetchFn(`${adminUrl}/id/${id}`, {
		method: "DELETE",
		headers: adminHeaders,
	});
	if (response.status === 404) {
		return;
	}
	await assertOk(response, context);
}

export function createCaddyClient(options: CaddyClientOptions = {}): CaddyRepository {
	const adminUrl = options.adminUrl ?? DEFAULT_ADMIN_URL;
	const fetchFn: FetchFn = options.fetch ?? globalThis.fetch;
	const authMode = options.authMode;
	const adminHeaders = {
		"Content-Type": "application/json",
		Origin: adminUrl,
	};

	return {
		async addWorkspaceRoute(name: string, vmIp: string): Promise<void> {
			const redirect = buildWorkspaceRedirectRoute(name);
			const redirectResponse = await fetchFn(`${adminUrl}${SRV1_ROUTES_PATH}`, {
				method: "POST",
				headers: adminHeaders,
				body: JSON.stringify(redirect),
			});
			await assertOk(redirectResponse, "addWorkspaceRoute (redirect)");

			const route = buildWorkspaceRoute(name, vmIp, authMode);
			const response = await fetchFn(`${adminUrl}${SRV1_ROUTES_PATH}`, {
				method: "POST",
				headers: adminHeaders,
				body: JSON.stringify(route),
			});
			await assertOk(response, "addWorkspaceRoute");
		},

		async removeWorkspaceRoute(name: string): Promise<void> {
			await deleteById(
				fetchFn,
				adminUrl,
				adminHeaders,
				workspaceRouteId(name),
				"removeWorkspaceRoute",
			);
			await deleteById(
				fetchFn,
				adminUrl,
				adminHeaders,
				workspaceRedirectId(name),
				"removeWorkspaceRoute (redirect)",
			);
		},

		async addPortRoute(workspaceName: string, vmIp: string, port: number): Promise<void> {
			const redirect = buildPortRedirectRoute(workspaceName, port);
			const redirectResponse = await fetchFn(`${adminUrl}${SRV2_ROUTES_PATH}`, {
				method: "POST",
				headers: adminHeaders,
				body: JSON.stringify(redirect),
			});
			await assertOk(redirectResponse, "addPortRoute (redirect)");

			const route = buildPortRoute(workspaceName, vmIp, port, authMode);
			const response = await fetchFn(`${adminUrl}${SRV2_ROUTES_PATH}`, {
				method: "POST",
				headers: adminHeaders,
				body: JSON.stringify(route),
			});
			await assertOk(response, "addPortRoute");
		},

		async removePortRoute(workspaceName: string, port: number): Promise<void> {
			await deleteById(
				fetchFn,
				adminUrl,
				adminHeaders,
				portRouteId(workspaceName, port),
				"removePortRoute",
			);
			await deleteById(
				fetchFn,
				adminUrl,
				adminHeaders,
				portRedirectId(workspaceName, port),
				"removePortRoute (redirect)",
			);
		},

		async bootstrap(config: unknown): Promise<void> {
			const response = await fetchFn(`${adminUrl}/load`, {
				method: "POST",
				headers: adminHeaders,
				body: JSON.stringify(config),
			});
			await assertOk(response, "bootstrap");
		},
	};
}
