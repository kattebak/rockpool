# EDD-020: User Preferences Sync Across Workspaces

| Field   | Value                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------- |
| Author  | mvhenten                                                                                           |
| Status  | Implemented                                                                                        |
| Created | 2026-02-26                                                                                         |
| Updated | 2026-02-26                                                                                         |
| Related | [EDD-005](005_Workspace_Image_Pipeline.md), [EDD-018](018_Repository_Cloning.md), [ADR-017](../ADR/017-code-server-web-ide.md) |

## Summary

IDE settings (theme, keybindings, editor preferences) should persist across workspaces. When a user changes their theme in one workspace, the next workspace they start should have the same theme. This EDD adds a `UserPrefsBlob` entity that stores preference files as blobs with timestamps, an enum-driven allowlist of syncable files, API endpoints for manual save/restore, and optional auto-sync on workspace stop.

## Prerequisites

- [ADR-017](../ADR/017-code-server-web-ide.md) — code-server as the IDE (defines where settings live on disk)
- [EDD-005](005_Workspace_Image_Pipeline.md) — Workspace image pipeline (VM SSH infrastructure)
- [EDD-018](018_Repository_Cloning.md) — Repository cloning (established pattern for SSH file operations during provisioning)

## Problem

Every workspace starts from the same base image. If a user customizes their IDE — changes the theme, adjusts keybindings, configures editor settings — those changes live on that workspace's VM disk. Starting a new workspace means starting from scratch. The user has to redo their setup every time.

The SSH infrastructure to read and write files inside VMs already exists (`sshExec` in tart-runtime). The missing piece is a data model to persist preference files and a sync mechanism to push/pull them during the workspace lifecycle.

## Design Goals

**Enum-driven.** A single TypeSpec enum defines the complete allowlist of syncable files — their logical names and filesystem paths. This enum drives validation, the API, and the SSH file operations. No stringly-typed paths scattered through the codebase.

**Timestamp-safe.** Each blob has an `updatedAt` timestamp. Auto-sync on stop only overwrites if the blob is newer than what's stored. This prevents an old workspace (stopped after a long idle) from clobbering settings saved more recently from another workspace.

**Opt-in auto-sync.** A per-workspace `autoSyncPrefs` flag controls whether settings are pulled back on stop. Manual save is always available. The user controls when and how their prefs propagate.

## Architecture

### Sync Flow

```
                    ┌──────────────────┐
                    │  UserPrefsBlob   │
                    │  (DB: name,      │
                    │   blob, updatedAt)│
                    └────┬────────┬────┘
                         │        │
              push on    │        │  pull on stop
              start      │        │  (auto) or
              (always)   │        │  manual save
                         ▼        │
                    ┌─────────────┴────┐
                    │   VM filesystem  │
                    │  ~/.local/share/ │
                    │  code-server/... │
                    └──────────────────┘
```

**Start (any workspace):** All stored `UserPrefsBlob` records are read from the DB and written into the VM via SSH, after `configure()` completes but before the health check passes. This reuses the existing SSH infrastructure.

**Manual save (`PUT /api/settings/:name`):** The server SSHs into a specified running workspace, reads the file at the enum-defined path, and stores it as a blob with the current timestamp.

**Auto-save on stop:** If the workspace has `autoSyncPrefs` enabled, the teardown step reads each allowlisted file from the VM before stopping it. Each blob is stored only if its content differs from what's in the DB (to avoid unnecessary timestamp bumps). The `updatedAt` is compared — if the DB already has a newer blob (saved manually from another workspace), the auto-save skips that file.

### Allowlist Enum

The TypeSpec enum is the single source of truth. Each value maps to a filesystem path inside the VM.

```typespec
enum UserPrefsFileName {
  CodeServerSettings,
  CodeServerKeybindings,
  GitConfig,
}
```

The mapping from enum value to filesystem path lives in a constant in the runtime package (not in TypeSpec — TypeSpec defines the data model, not runtime behavior):

```typescript
const PREFS_FILE_PATHS: Record<UserPrefsFileName, string> = {
  CodeServerSettings: ".local/share/code-server/User/settings.json",
  CodeServerKeybindings: ".local/share/code-server/User/keybindings.json",
  GitConfig: ".gitconfig",
};
```

All paths are relative to the SSH user's home directory (`/home/admin/`). Adding a new syncable file means adding an enum value and a path entry — nothing else changes.

### Timestamp Conflict Prevention

The auto-sync-on-stop scenario where timestamps matter:

1. User starts workspace A, changes theme → auto-syncs on stop at T1
2. User starts workspace B, changes keybindings → saves manually at T2
3. User stops workspace A (which was idle since T1)

Without timestamp checks, step 3 would overwrite the keybindings saved at T2 with the older version from workspace A. With timestamps:

- Auto-sync reads the DB's `updatedAt` for each file before writing
- If DB `updatedAt` >= file's modification time from the VM, the auto-sync skips that file
- Manual save always writes (explicit user action takes precedence)

In practice, the comparison is simple: auto-sync does a conditional update (`UPDATE ... WHERE updatedAt < ?`). Manual save does an unconditional upsert.

## Data Model

### TypeSpec

```typespec
enum UserPrefsFileName {
  CodeServerSettings,
  CodeServerKeybindings,
  GitConfig,
}

@table("user_prefs_blob", "rockpool")
model UserPrefsBlob {
  @pk
  name: UserPrefsFileName;

  blob: string;

  @updatedAt
  @visibility(Lifecycle.Read)
  updatedAt: utcDateTime;
}
```

The `name` column is the primary key — there's exactly one blob per preference file. This is a single-user system; multi-user would add a `userId` FK as part of the PK.

### Workspace Extension

Add `autoSyncPrefs` to the existing `Workspace` model:

```typespec
@table("workspace", "rockpool")
model Workspace {
  // ... existing fields ...

  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  autoSyncPrefs?: boolean;
}
```

Defaults to `false` (no column default needed — absence means off). The user enables it per workspace. This avoids surprising behavior where stopping any workspace silently overwrites settings.

## API Design

### Endpoints

| Method | Path                  | Description                                              |
| ------ | --------------------- | -------------------------------------------------------- |
| GET    | `/api/settings`       | List all stored preference blobs                         |
| GET    | `/api/settings/:name` | Get a single preference blob by enum name                |
| PUT    | `/api/settings/:name` | Save a preference blob (reads from a running workspace)  |

### PUT /api/settings/:name

```typescript
// Request
PUT /api/settings/CodeServerSettings?workspaceId=abc123

// Response 200
{
  "name": "CodeServerSettings",
  "blob": "{ \"workbench.colorTheme\": \"One Dark Pro\" ... }",
  "updatedAt": "2026-02-26T12:00:00Z"
}
```

The `workspaceId` query parameter identifies which running workspace to read the file from. The server:

1. Validates `name` against the `UserPrefsFileName` enum (400 if invalid)
2. Looks up the workspace, confirms it's running and has a `vmIp` (409 if not running)
3. SSHs into the VM, reads the file at the enum-mapped path
4. Upserts the blob in the DB with `updatedAt = now()`
5. Returns the stored blob

### GET /api/settings/:name

Returns the stored blob, or 404 if no blob exists for that name. No SSH involved — purely a DB read.

### GET /api/settings

Returns all stored blobs as an array. Used by the frontend to show which preferences are synced and when they were last updated.

## Implementation Details

### Runtime: readFile / writeFile

Add two methods to the `RuntimeRepository` interface:

```typescript
export interface RuntimeRepository {
    // ... existing methods ...
    readFile?(name: string, vmIp: string, filePath: string): Promise<string>;
    writeFile?(name: string, vmIp: string, filePath: string, content: string): Promise<void>;
}
```

Both are optional (like `configure` and `clone`) so the stub runtime can omit them.

Implementation in tart-runtime uses `sshExec`:

```typescript
async readFile(_name: string, vmIp: string, filePath: string): Promise<string> {
    return sshExec(vmIp, `cat /home/${sshUser}/${filePath}`);
}

async writeFile(_name: string, vmIp: string, filePath: string, content: string): Promise<void> {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    await sshExec(vmIp, `mkdir -p /home/${sshUser}/${dir} && printf '%s' '${escapeSingleQuotes(content)}' > /home/${sshUser}/${filePath}`);
}
```

### Workspace Service: Push on Start

In `provisionAndStart`, after `configureAndWait` succeeds and before the Caddy route is added, push all stored preference blobs into the VM:

```typescript
const blobs = await getAllUserPrefsBlobs(db);
await Promise.all(
    blobs.map(blob =>
        runtime.writeFile?.(workspace.name, vmIp, PREFS_FILE_PATHS[blob.name], blob.blob)
    )
);
```

This runs after code-server is configured but before the workspace is marked "running". The settings are in place when the user first opens the IDE.

Note: writing preferences after `configureAndWait` means code-server is already running. For `settings.json`, code-server watches the file and hot-reloads changes — no restart needed. For keybindings, same behavior. For `.gitconfig`, it's read on each git operation, so no reload needed either.

### Workspace Service: Pull on Stop

In `teardown("stop")`, before stopping the VM, if `autoSyncPrefs` is enabled:

```typescript
if (workspace.autoSyncPrefs && workspace.vmIp) {
    for (const [name, filePath] of Object.entries(PREFS_FILE_PATHS)) {
        const content = await runtime.readFile?.(workspace.name, workspace.vmIp, filePath)
            .catch(() => null);
        if (content === null || content === undefined) continue;

        await conditionalUpsertPrefsBlob(db, {
            name: name as UserPrefsFileName,
            blob: content,
        });
    }
}
```

`conditionalUpsertPrefsBlob` does an `INSERT ... ON CONFLICT(name) DO UPDATE SET blob = ?, updatedAt = ? WHERE updatedAt < ?`. This is the timestamp guard — it only writes if the DB's version is older.

The `catch(() => null)` handles files that don't exist yet (user never opened settings UI, so no `settings.json`). Missing files are silently skipped.

### Server Routes

New route file `packages/server/src/routes/settings.ts`:

```typescript
// GET /api/settings
// GET /api/settings/:name
// PUT /api/settings/:name?workspaceId=xxx
```

The PUT handler needs access to the runtime to SSH into the workspace. It gets this through the same dependency injection pattern used by the workspace routes. The workspace must be in "running" state with a `vmIp` — otherwise 409.

### Error Handling

| Failure | Behavior | HTTP Status |
| --- | --- | --- |
| Invalid pref name | Reject with enum validation error | 400 |
| Workspace not running | Cannot read file from stopped VM | 409 |
| File doesn't exist in VM | Return empty / skip (auto-sync) | 404 (manual) / skip (auto) |
| SSH failure during manual save | Propagate error | 502 |
| SSH failure during auto-sync on stop | Log warning, continue teardown | N/A (background) |
| SSH failure during push on start | Log warning, continue startup | N/A (background) |

Auto-sync failures (on stop and on start) are non-fatal. Preferences are a convenience — they should never block workspace lifecycle operations. Manual save failures are reported to the user since they explicitly requested the operation.

## Implementation Steps

### Step 1: TypeSpec model and enum ✅

Added `UserPrefsFileName` enum, `UserPrefsBlob` model, and `autoSyncPrefs` to `Workspace` in `typespec/main.tsp`. Added the settings API interface. Ran `make all` to regenerate build packages.

### Step 2: DB migration and queries ✅

Added the `user_prefs_blob` table with queries: `getAllUserPrefsBlobs`, `getUserPrefsBlob`, `upsertUserPrefsBlob`.

Note: `conditionalUpsertPrefsBlob` (timestamp-guarded upsert for auto-sync) deferred until auto-sync on stop is implemented.

### Step 3: Prefs file path mapping ✅

Added `PREFS_FILE_PATHS` constant, `readFile`/`writeFile` to `RuntimeRepository` interface, implemented in tart-runtime via `sshExec`. Stub-runtime omits them (optional methods).

### Step 4: Push prefs on workspace start ✅

`provisionAndStart` reads all stored blobs from DB and writes them into the VM after configure completes, before the workspace is marked running.

### Step 5: Pull prefs on workspace stop — deferred

Auto-sync on stop is designed but not yet implemented. Manual save via the API and frontend UI covers the primary use case.

### Step 6: Settings API routes ✅

Server routes for listing, getting, and manually saving preference blobs. The PUT handler catches SSH failures when files don't exist on the VM (code-server doesn't create `settings.json` or `keybindings.json` until the user first modifies a setting) and returns 404.

### Step 7: Frontend preferences UI ✅

Added a `PrefsPanel` component to the workspace detail page (visible when workspace is running):
- Table of all 3 preference types with "Last saved" timestamps
- "Save all" button saves in parallel via `Promise.allSettled`, silently skips 404s for files that don't exist yet on the VM, reports count of successful saves
- Individual per-preference save buttons

### Step 8: E2E tests ✅

Added `e2e/tests/06-preferences-save.spec.ts` (5 tests, skips on CI profile):
- Settings list API returns empty array initially
- Settings save returns 404 for files not yet created on VM
- Preferences panel renders in workspace detail
- Timestamps show "Never" before any save
- Save all silently skips missing files

## File Changes

```
typespec/main.tsp                                     -- enum, model, API, workspace field
packages/db/src/schema.ts                             -- user_prefs_blob table
packages/db/src/queries.ts                            -- blob CRUD + conditional upsert
packages/runtime/src/prefs.ts                         -- PREFS_FILE_PATHS mapping
packages/runtime/src/types.ts                         -- readFile/writeFile interface
packages/runtime/src/tart-runtime.ts                  -- implement readFile/writeFile
packages/runtime/src/stub-runtime.ts                  -- no-op stubs
packages/workspace-service/src/workspace-service.ts   -- push on start, pull on stop
packages/server/src/routes/settings.ts                -- settings API routes
packages/server/src/app.ts                            -- register settings routes
packages/runtime/test/tart-runtime.test.ts            -- readFile/writeFile tests
packages/workspace-service/test/workspace-service.test.ts -- sync behavior tests
```

## Decisions

| Question | Decision | Rationale |
| --- | --- | --- |
| Where to store blobs? | DB (`user_prefs_blob` table) | Simple, already have SQLite. No filesystem state to manage on the host. Blobs are small (< 100KB). |
| Allowlist mechanism? | TypeSpec enum → generated code | Single source of truth. Compile-time validation. Adding a file means one enum entry + one path mapping. |
| Auto-sync default? | Off (`autoSyncPrefs` defaults to false) | Explicit opt-in avoids surprise. User chooses which workspaces propagate settings. |
| Conflict resolution? | Timestamp-guarded conditional upsert | Simple, correct for single-user. Manual save always wins. Auto-sync defers to newer. |
| Push prefs timing? | After configure, before health check passes | code-server hot-reloads settings.json. No restart needed. Settings are ready when user opens IDE. |
| Auto-sync failure behavior? | Non-fatal (log + continue) | Preferences should never block workspace start/stop. |
| Multi-user? | Deferred | No user table yet. When added, extend PK to `(userId, name)`. |

## Scope Exclusions

**Extension sync** is out of scope. Extensions are large (megabytes each) and don't fit the blob model. A future mechanism could sync an extension list and run `code-server --install-extension` on start, but that's a separate feature.

**Preference management UI** is implemented. A PrefsPanel component on the workspace detail page shows each syncable file with its last-saved timestamp and per-file or bulk "Save all" actions.

**Workspace-specific settings** are not a concern. code-server already separates User settings (global, what we sync) from Workspace settings (`.vscode/settings.json` in the project directory, travels with the git clone). We only sync User-level files.

## Open Questions

- [ ] **Default preferences.** Should the workspace image (`setup.sh`) bake in a default `settings.json` with sensible defaults (theme, font size, etc.)? This would give new users a good starting point before they've saved any preferences.
