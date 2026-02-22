# EDD: Data Model

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Draft      |
| Created | 2026-02-22 |
| Updated | 2026-02-23 |

## Summary

TypeSpec-first data model for the Rockpool control plane. Defines the core entities, their relationships, and the API surface. TypeSpec compiles to OpenAPI, Zod schemas, TypeScript types, and Drizzle ORM table definitions (see [ADR-003](../ADR/003-typespec-api-first.md), [ADR-009](../ADR/009-sqlite-drizzle-orm.md)).

## Prerequisites

- [ADR-003: TypeSpec API-first](../ADR/003-typespec-api-first.md)
- [ADR-009: SQLite + Drizzle ORM](../ADR/009-sqlite-drizzle-orm.md)
- [EDD 001: Architecture Overview](001_Architecture_Overview.md)

## Core Entities

### Workspace

The central entity. Represents a running or stopped development environment.

- `id` (uuid, auto-generated) -- internal primary key, used for DB references and service-layer lookups.
- `name` (string, user-provided slug) -- appears in URLs (`/workspace/{name}/*`). Validated: lowercase `[a-z0-9-]`, 3-63 characters, unique.
- `status` (enum) -- lifecycle state, see state machine below.
- `image` (string) -- base image identifier (e.g. `debian-codeserver-v1`). No separate Image entity; promote to its own model when multiple managed images are needed.
- `vmIp` (string, nullable) -- populated when the VM is running, null when stopped or pending.
- `errorMessage` (string, nullable) -- populated when status is `error`, null otherwise.
- `createdAt` / `updatedAt` (datetime) -- standard timestamps.

```typespec
model Workspace {
  @key id: string;
  name: string;
  status: WorkspaceStatus;
  image: string;
  vmIp?: string;
  errorMessage?: string;
  createdAt: utcDateTime;
  updatedAt: utcDateTime;
}

enum WorkspaceStatus {
  creating,
  running,
  stopping,
  stopped,
  error,
}
```

### Workspace State Machine

Status transitions are enforced in the **service layer**, not the model. The TypeSpec enum defines valid states; the workspace service enforces which transitions are allowed.

```
            ┌──────────┐
            │ creating  │──────────────┐
            └────┬─────┘              │
                 │ success             │ failure
                 ▼                     ▼
            ┌──────────┐         ┌─────────┐
     ┌─────▶│ running  │────────▶│  error  │
     │      └────┬─────┘         └─────────┘
     │           │ stop                ▲
     │           ▼                     │
     │      ┌──────────┐              │
     │      │ stopping │──────────────┘
     │      └────┬─────┘   failure
     │           │ success
     │           ▼
     │      ┌──────────┐
     └──────│ stopped  │
      start └──────────┘
```

Valid transitions:

| From     | To       | Trigger                |
| -------- | -------- | ---------------------- |
| (new)    | creating | `POST /api/workspaces` |
| creating | running  | VM ready, IP assigned  |
| creating | error    | VM creation failed     |
| running  | stopping | `POST .../stop`        |
| stopping | stopped  | VM confirmed stopped   |
| stopping | error    | Stop timed out/failed  |
| stopped  | creating | `POST .../start`       |

### Port

A registered port forwarding for a workspace. Apps inside the VM bind to arbitrary ports; the user registers them to make them accessible via Caddy at `/workspace/{name}/port/{port}/*`. Capped at 5 registered ports per workspace.

- `workspaceId` (string) -- references the parent workspace.
- `port` (integer) -- the actual port number inside the VM (e.g. 3000, 5000). Must be in range 1024-65535. Unique per workspace.
- `label` (string, optional) -- human-readable name (e.g. "frontend", "api").
- `createdAt` (datetime) -- when the port was registered.

```typespec
model Port {
  workspaceId: string;
  port: int32;
  label?: string;
  createdAt: utcDateTime;
}
```

When a port is registered, the worker creates a Caddy route: `/workspace/{name}/port/{port}/*` → `VM_IP:{port}`. When removed, the route is deleted. See [EDD 003](003_Caddy_Reverse_Proxy.md) for route structure.

### Excluded Entities

These were considered but deferred:

- **Image** -- image is a string field on Workspace. A dedicated Image entity adds schema and API surface with no current benefit. Single base image built locally per [EDD-005](005_Workspace_Image_Pipeline.md). Promote when multiple managed images are needed.
- **Runtime** -- runtime (Tart now, Incus later) is a host-level property, not per-workspace data. The adapter pattern ([EDD-002](002_MicroVM_Runtime.md)) handles platform differences. Workspace entity stays runtime-agnostic.

## API Surface

No version prefix. The API is served at `/api/` directly. Versioning (e.g. `/api/v2/`) can be introduced if breaking changes are needed for external consumers.

## API Standards

These standards apply to all current and future endpoints. Prefer explicit, bespoke endpoints over flexible query parameters that create complex or ambiguous behavior.

### Limits and Pagination

- **All list endpoints must be paginated.** Use `limit` + `cursor` (opaque string) for pagination.
- **Default `limit`: 25. Max `limit`: 100.** Defaults are soft limits intentionally below hard caps. Requests above max are clamped to 100.
- **Responses include `nextCursor` when more results are available.**

**Implementation status:** `GET /api/workspaces` is paginated (TypeSpec `WorkspaceListResponse` model, cursor-based with base64url-encoded `createdAt|id`, `ORDER BY createdAt DESC, id DESC`, `LIMIT n+1` strategy). Port listing (`GET /api/workspaces/{id}/ports`) is not yet paginated (low cardinality, max 5 per workspace).

### Rate Limiting

- **All endpoints are rate-limited at the Caddy gateway.** Default: 60 requests per minute per client (soft), 300 requests per minute (hard).
- **Lifecycle endpoints are stricter.** `start`, `stop`, `create`, `delete`: 10 requests per minute (soft), 30 per minute (hard).
- **When exceeded:** return `429` with a JSON error body.

### Max Counts and Enforcement

- **Hard caps are enforced server-side.** Examples: max 5 ports per workspace, max N workspaces per host.
- **Max workspaces per host: 999.** Requests beyond this cap are rejected.
- **Soft limit for workspaces: 50.** Defaults and UI guidance should stay well below the hard cap.
- **Max ports per workspace: 5.** Hard cap, enforced on registration.
- **Max concurrent workspace starts per host: 3.** Additional start requests are queued or rejected.
- **Max image list size: 20.** Lists beyond this are paginated with a default limit.
- **Reject requests that exceed caps** with a clear error message and code.

### Endpoint Design Bias

- **Prefer bespoke endpoints** for specific user intents (e.g., `/start`, `/stop`, `/ports`) instead of generic query-based endpoints.
- **Avoid filter explosion.** If a query requires multiple optional filters, add a purpose-built endpoint instead.

### Error Response Standards

- **All errors return JSON.** No HTML error pages.
- **Validation errors use `400`** with a structured body that includes field-level details.
- **Conflict errors use `409`** for invalid state transitions or duplicate names.
- **Not found uses `404`,** unauthorized `401`, forbidden `403`.
- **Rate limit uses `429`.**
- **Server errors use `500`,** dependency failures use `503`.

Error body shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Name is required",
    "fields": [{ "field": "name", "message": "Required" }]
  }
}
```

### Workspace CRUD

| Method | Path                   | Description            |
| ------ | ---------------------- | ---------------------- |
| GET    | `/api/workspaces`      | List all workspaces    |
| POST   | `/api/workspaces`      | Create a new workspace |
| GET    | `/api/workspaces/{id}` | Get workspace details  |
| DELETE | `/api/workspaces/{id}` | Delete a workspace     |

### Workspace Lifecycle

| Method | Path                         | Description       |
| ------ | ---------------------------- | ----------------- |
| POST   | `/api/workspaces/{id}/start` | Start a workspace |
| POST   | `/api/workspaces/{id}/stop`  | Stop a workspace  |

### Port Forwarding

| Method | Path                                | Description                 |
| ------ | ----------------------------------- | --------------------------- |
| GET    | `/api/workspaces/{id}/ports`        | List registered ports       |
| POST   | `/api/workspaces/{id}/ports`        | Register a port (max 5)     |
| DELETE | `/api/workspaces/{id}/ports/{port}` | Unregister a forwarded port |

Registering a port triggers a Caddy route creation; unregistering removes it. Ports can only be registered when the workspace is `running`.

## TypeSpec Project Structure

TypeSpec source lives in `typespec/` at the repo root as its own npm workspace ([ADR-007](../ADR/007-npm-workspaces.md)). Generated outputs (OpenAPI, Zod schemas, TypeScript types, Drizzle table definitions) are emitted into the consuming packages.

## Decisions

| Question              | Decision                                                         | Rationale                                                         |
| --------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| Workspace fields      | Minimal: id, name, status, image, vmIp, errorMessage, timestamps | Add fields when needed, not speculatively                         |
| Separate Image entity | No, string field on Workspace                                    | Single base image, no registry, no management UI                  |
| Workspace templates   | Single default image template                                    | Start simple, avoid template management UI                        |
| Workspace naming      | UUID `id` + user-provided `name` slug                            | `id` for internals, `name` for URLs and display                   |
| Status transitions    | Service layer                                                    | Model is pure data; service enforces the state machine            |
| Port entity           | Yes, tracked sub-resource of Workspace                           | Dynamic port registration, Caddy routes created/removed on demand |
| Runtime field         | No, inferred from host                                           | Adapter pattern keeps workspace runtime-agnostic                  |
| API versioning        | `/api/` (no version prefix)                                      | Single-user tool, no external consumers                           |
| TypeSpec location     | `typespec/` at repo root, own npm workspace                      | Matches ADR-003 and ADR-007                                       |
| Timestamps            | Stored in UTC                                                    | UI handles localization and accessibility                         |
| Audit trail           | Minimal activity log only                                        | Basic history without heavy audit system                          |
