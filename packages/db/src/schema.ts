import { int, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import short from "short-uuid";

const translator = short(short.constants.uuid25Base36);

export function generateId(): string {
	return translator.generate();
}

export const workspaces = sqliteTable("workspaces", {
	id: text("id").primaryKey().$defaultFn(generateId),
	name: text("name").notNull().unique(),
	status: text("status", {
		enum: ["creating", "running", "stopping", "stopped", "error"],
	})
		.notNull()
		.default("creating"),
	image: text("image").notNull(),
	vmIp: text("vm_ip"),
	errorMessage: text("error_message"),
	createdAt: int("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: int("updated_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceStatus = Workspace["status"];

export const ports = sqliteTable(
	"ports",
	{
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		port: int("port").notNull(),
		label: text("label"),
		createdAt: int("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [primaryKey({ columns: [table.workspaceId, table.port] })],
);

export type Port = typeof ports.$inferSelect;
export type NewPort = typeof ports.$inferInsert;
