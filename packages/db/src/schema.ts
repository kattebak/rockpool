import { port, workspace as workspaces } from "@rockpool/db-schema";
import short from "short-uuid";

const translator = short(short.constants.uuid25Base36);

export function generateId(): string {
	return translator.generate();
}

export { workspaces };

export const ports = port;

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceStatus = Workspace["status"];

export type Port = typeof ports.$inferSelect;
export type NewPort = typeof ports.$inferInsert;
