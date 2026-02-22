export interface CaddyRoute {
	"@id": string;
	match: Array<{ path: string[] }>;
	handle: unknown[];
	terminal: boolean;
}

export interface CaddyRepository {
	addWorkspaceRoute(name: string, vmIp: string): Promise<void>;
	removeWorkspaceRoute(name: string): Promise<void>;
	addPortRoute(workspaceName: string, vmIp: string, port: number): Promise<void>;
	removePortRoute(workspaceName: string, port: number): Promise<void>;
	bootstrap(config: unknown): Promise<void>;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface CaddyClientOptions {
	adminUrl?: string;
	fetch?: FetchFn;
}

export interface BasicAuthCredentials {
	username: string;
	passwordHash: string;
}

export interface BootstrapOptions {
	auth?: BasicAuthCredentials;
	controlPlaneUrl?: string;
	spaRoot?: string;
	srv1Port?: number;
}
