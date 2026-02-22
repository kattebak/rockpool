# EDD: Data Model

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Draft      |
| Created | 2026-02-22 |
| Updated | 2026-02-22 |

## Summary

TypeSpec-first data model for the Tidepool control plane. Defines the core entities, their relationships, and the API surface. TypeSpec compiles to OpenAPI, Zod schemas, TypeScript types, and Drizzle ORM table definitions (see [ADR-003](../ADR/003-typespec-api-first.md), [ADR-009](../ADR/009-sqlite-drizzle-orm.md)).

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
- `image` (string) -- base image identifier (e.g. `alpine-codeserver-v1`). No separate Image entity; promote to its own model when multiple managed images are needed.
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
- **Runtime** -- runtime (Tart/Incus) is a host-level property, not per-workspace data. The adapter pattern ([EDD-002](002_MicroVM_Runtime.md)) handles platform differences. Workspace entity stays runtime-agnostic.

## API Surface

No version prefix. The API is served at `/api/` directly. Versioning (e.g. `/api/v2/`) can be introduced if breaking changes are needed for external consumers.

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

| Method | Path                                | Description                   |
| ------ | ----------------------------------- | ----------------------------- |
| GET    | `/api/workspaces/{id}/ports`        | List registered ports         |
| POST   | `/api/workspaces/{id}/ports`        | Register a port (max 5)       |
| DELETE | `/api/workspaces/{id}/ports/{port}` | Unregister a forwarded port   |

Registering a port triggers a Caddy route creation; unregistering removes it. Ports can only be registered when the workspace is `running`.

## TypeSpec Project Structure

TypeSpec source lives in `typespec/` at the repo root as its own npm workspace ([ADR-007](../ADR/007-npm-workspaces.md)). Generated outputs (OpenAPI, Zod schemas, TypeScript types, Drizzle table definitions) are emitted into the consuming packages.

## Decisions

| Question              | Decision                                                         | Rationale                                              |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| Workspace fields      | Minimal: id, name, status, image, vmIp, errorMessage, timestamps | Add fields when needed, not speculatively              |
| Separate Image entity | No, string field on Workspace                                    | Single base image, no registry, no management UI       |
| Workspace naming      | UUID `id` + user-provided `name` slug                            | `id` for internals, `name` for URLs and display        |
| Status transitions    | Service layer                                                    | Model is pure data; service enforces the state machine |
| Port entity           | Yes, tracked sub-resource of Workspace                           | Dynamic port registration, Caddy routes created/removed on demand |
| Runtime field         | No, inferred from host                                           | Adapter pattern keeps workspace runtime-agnostic       |
| API versioning        | `/api/` (no version prefix)                                      | Single-user tool, no external consumers                |
| TypeSpec location     | `typespec/` at repo root, own npm workspace                      | Matches ADR-003 and ADR-007                            |
