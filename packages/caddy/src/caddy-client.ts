import type { CaddyClientOptions, CaddyRepository, FetchFn } from "./types.ts";

const DEFAULT_ADMIN_URL = "http://localhost:2019";
const SRV1_ROUTES_PATH = "/config/apps/http/servers/srv1/routes";

function workspaceRouteId(name: string): string {
	return `workspace-${name}`;
}

function portRouteId(workspaceName: string, port: number): string {
	return `workspace-${workspaceName}-port-${port}`;
}

function workspaceSubroutePath(name: string): string {
	return `/id/${workspaceRouteId(name)}/handle/0/routes`;
}

function buildWorkspaceRoute(name: string, vmIp: string): unknown {
	const pathPrefix = `/workspace/${name}`;
	return {
		"@id": workspaceRouteId(name),
		match: [{ path: [`${pathPrefix}/*`] }],
		handle: [
			{
				handler: "subroute",
				routes: [
					{
						handle: [
							{ handler: "rewrite", strip_path_prefix: pathPrefix },
							{
								handler: "reverse_proxy",
								upstreams: [{ dial: `${vmIp}:8080` }],
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
						],
					},
				],
			},
		],
		terminal: true,
	};
}

function buildPortRoute(workspaceName: string, vmIp: string, port: number): unknown {
	const pathPrefix = `/workspace/${workspaceName}/port/${port}`;
	return {
		"@id": portRouteId(workspaceName, port),
		match: [{ path: [`${pathPrefix}/*`] }],
		handle: [
			{ handler: "rewrite", strip_path_prefix: pathPrefix },
			{
				handler: "reverse_proxy",
				upstreams: [{ dial: `${vmIp}:${port}` }],
				flush_interval: -1,
				headers: {
					request: {
						set: {
							"X-Forwarded-Prefix": [pathPrefix],
						},
					},
				},
			},
		],
		terminal: true,
	};
}

async function assertOk(response: Response, context: string): Promise<void> {
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Caddy ${context}: ${response.status} ${body}`);
	}
}

export function createCaddyClient(options: CaddyClientOptions = {}): CaddyRepository {
	const adminUrl = options.adminUrl ?? DEFAULT_ADMIN_URL;
	const fetchFn: FetchFn = options.fetch ?? globalThis.fetch;
	const adminHeaders = {
		"Content-Type": "application/json",
		Origin: adminUrl,
	};

	return {
		async addWorkspaceRoute(name: string, vmIp: string): Promise<void> {
			const route = buildWorkspaceRoute(name, vmIp);
			const response = await fetchFn(`${adminUrl}${SRV1_ROUTES_PATH}`, {
				method: "POST",
				headers: adminHeaders,
				body: JSON.stringify(route),
			});
			await assertOk(response, "addWorkspaceRoute");
		},

		async removeWorkspaceRoute(name: string): Promise<void> {
			const id = workspaceRouteId(name);
			const response = await fetchFn(`${adminUrl}/id/${id}`, {
				method: "DELETE",
				headers: adminHeaders,
			});
			if (response.status === 404) {
				return;
			}
			await assertOk(response, "removeWorkspaceRoute");
		},

		async addPortRoute(workspaceName: string, vmIp: string, port: number): Promise<void> {
			const route = buildPortRoute(workspaceName, vmIp, port);
			const subroutePath = workspaceSubroutePath(workspaceName);
			const response = await fetchFn(`${adminUrl}${subroutePath}`, {
				method: "POST",
				headers: adminHeaders,
				body: JSON.stringify(route),
			});
			await assertOk(response, "addPortRoute");
		},

		async removePortRoute(workspaceName: string, port: number): Promise<void> {
			const id = portRouteId(workspaceName, port);
			const response = await fetchFn(`${adminUrl}/id/${id}`, {
				method: "DELETE",
				headers: adminHeaders,
			});
			if (response.status === 404) {
				return;
			}
			await assertOk(response, "removePortRoute");
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
