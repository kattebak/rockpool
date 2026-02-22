export type WorkspaceStatus = "creating" | "running" | "stopping" | "stopped" | "error";

export interface Workspace {
	id: string;
	name: string;
	status: WorkspaceStatus;
	image: string;
	vmIp?: string;
	errorMessage?: string;
	createdAt: string;
	updatedAt: string;
}

export interface Port {
	port: number;
	label?: string;
	createdAt: string;
}

export interface CreateWorkspaceRequest {
	name: string;
	image: string;
}

export interface AddPortRequest {
	port: number;
	label?: string;
}
