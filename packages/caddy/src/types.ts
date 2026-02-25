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
	authMode?: AuthMode;
}

export interface BasicAuthCredentials {
	username: string;
	passwordHash: string;
}

export type AuthMode =
	| { mode: "basic"; credentials: BasicAuthCredentials }
	| { mode: "oauth"; controlPlaneDial: string; srv0Port: number };

export interface BootstrapOptions {
	spaRoot?: string;
	spaProxyUrl?: string;
	controlPlaneUrl?: string;
	srv0Port?: number;
	srv1Port?: number;
	srv2Port?: number;
	authMode?: AuthMode;
}
