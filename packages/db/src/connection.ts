import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

export type DbClient = ReturnType<typeof createDb>;

const CREATE_REPOSITORY_SQL = `
CREATE TABLE IF NOT EXISTS repository (
	id TEXT PRIMARY KEY,
	full_name TEXT NOT NULL,
	owner TEXT NOT NULL,
	owner_type TEXT NOT NULL,
	owner_avatar TEXT NOT NULL,
	description TEXT,
	default_branch TEXT NOT NULL,
	private INTEGER NOT NULL,
	created_at INTEGER NOT NULL
)`;

const CREATE_WORKSPACES_SQL = `
CREATE TABLE IF NOT EXISTS workspace (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	status TEXT NOT NULL DEFAULT 'creating',
	image TEXT NOT NULL,
	description TEXT,
	repository_id TEXT REFERENCES repository(id),
	vm_ip TEXT,
	error_message TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
)`;

const CREATE_PORTS_SQL = `
CREATE TABLE IF NOT EXISTS port (
	workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
	port INTEGER NOT NULL,
	label TEXT,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (workspace_id, port)
)`;

function addColumnIfMissing(
	sqlite: Database.Database,
	table: string,
	column: string,
	type: string,
): void {
	const columns = sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>;
	if (columns.some((c) => c.name === column)) return;
	sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function createDb(dbPath: string) {
	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	sqlite.exec(CREATE_REPOSITORY_SQL);
	sqlite.exec(CREATE_WORKSPACES_SQL);
	sqlite.exec(CREATE_PORTS_SQL);

	addColumnIfMissing(sqlite, "workspace", "description", "TEXT");
	addColumnIfMissing(sqlite, "workspace", "repository_id", "TEXT REFERENCES repository(id)");

	return drizzle({ client: sqlite, schema });
}

export function createMemoryDb() {
	return createDb(":memory:");
}
