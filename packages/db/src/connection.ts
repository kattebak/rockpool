import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

export type DbClient = ReturnType<typeof createDb>;

const CREATE_WORKSPACES_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	status TEXT NOT NULL DEFAULT 'creating',
	image TEXT NOT NULL,
	vm_ip TEXT,
	error_message TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
)`;

const CREATE_PORTS_SQL = `
CREATE TABLE IF NOT EXISTS ports (
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	port INTEGER NOT NULL,
	label TEXT,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (workspace_id, port)
)`;

export function createDb(dbPath: string) {
	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	sqlite.exec(CREATE_WORKSPACES_SQL);
	sqlite.exec(CREATE_PORTS_SQL);

	return drizzle({ client: sqlite, schema });
}

export function createMemoryDb() {
	return createDb(":memory:");
}
