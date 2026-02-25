import {
	port,
	repository as repositories,
	user_prefs_blob as userPrefsBlobs,
	workspace_repository as workspaceRepositories,
	workspace as workspaces,
} from "@rockpool/db-schema";
import short from "short-uuid";

const translator = short(short.constants.uuid25Base36);

export function generateId(): string {
	return translator.generate();
}

export { workspaces, repositories, workspaceRepositories, userPrefsBlobs };

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

export type UserPrefsBlob = typeof userPrefsBlobs.$inferSelect;
export type NewUserPrefsBlob = typeof userPrefsBlobs.$inferInsert;
export type UserPrefsFileName = UserPrefsBlob["name"];
