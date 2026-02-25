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

const CREATE_WORKSPACE_REPOSITORY_SQL = `
CREATE TABLE IF NOT EXISTS workspace_repository (
	workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
	repository_id TEXT NOT NULL REFERENCES repository(id),
	created_at INTEGER NOT NULL,
	PRIMARY KEY (workspace_id, repository_id)
)`;

const CREATE_USER_PREFS_BLOB_SQL = `
CREATE TABLE IF NOT EXISTS user_prefs_blob (
	name TEXT PRIMARY KEY,
	blob TEXT NOT NULL,
	updated_at INTEGER NOT NULL
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

function dropColumnIfPresent(sqlite: Database.Database, table: string, column: string): void {
	const columns = sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>;
	if (!columns.some((c) => c.name === column)) return;
	sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}

export function createDb(dbPath: string) {
	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	sqlite.exec(CREATE_REPOSITORY_SQL);
	sqlite.exec(CREATE_WORKSPACES_SQL);
	sqlite.exec(CREATE_PORTS_SQL);
	sqlite.exec(CREATE_WORKSPACE_REPOSITORY_SQL);
	sqlite.exec(CREATE_USER_PREFS_BLOB_SQL);

	addColumnIfMissing(sqlite, "workspace", "description", "TEXT");
	addColumnIfMissing(sqlite, "workspace", "auto_sync_prefs", "INTEGER");
	dropColumnIfPresent(sqlite, "workspace", "repository_id");

	return drizzle({ client: sqlite, schema });
}

export function createMemoryDb() {
	return createDb(":memory:");
}
