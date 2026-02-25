import type { WorkspaceWritable } from "@rockpool/sdk";

export type {
	GitHubRepo,
	GitHubRepoListResponse,
	GitHubRepoSearchResponse,
	Port,
	PortWritable as AddPortRequest,
	Workspace,
	WorkspaceListResponse,
	WorkspaceStatus,
} from "@rockpool/sdk";

export type CreateWorkspaceRequest = WorkspaceWritable & {
	repositoryId?: string;
};
