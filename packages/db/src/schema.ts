import {
	port,
	repository as repositories,
	workspace_repository as workspaceRepositories,
	workspace as workspaces,
} from "@rockpool/db-schema";
import short from "short-uuid";

const translator = short(short.constants.uuid25Base36);

export function generateId(): string {
	return translator.generate();
}

export { workspaces, repositories, workspaceRepositories };

export const ports = port;

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceStatus = Workspace["status"];

export type Port = typeof ports.$inferSelect;
export type NewPort = typeof ports.$inferInsert;

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;

export type WorkspaceRepository = typeof workspaceRepositories.$inferSelect;
export type NewWorkspaceRepository = typeof workspaceRepositories.$inferInsert;
