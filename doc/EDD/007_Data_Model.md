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

```typespec
model Workspace {
  @key id: string;
  name: string;
  status: WorkspaceStatus;
  image: string;
  vmIp?: string;
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

### Image (future?)

Represents an available base image for creating workspaces.

```typespec
model Image {
  @key id: string;
  name: string;
  runtime: Runtime;
  createdAt: utcDateTime;
}

enum Runtime {
  tart,
  incus,
}
```

## API Surface

### Workspace CRUD

| Method | Path                    | Description              |
|--------|-------------------------|--------------------------|
| GET    | `/api/workspaces`       | List all workspaces      |
| POST   | `/api/workspaces`       | Create a new workspace   |
| GET    | `/api/workspaces/{id}`  | Get workspace details    |
| DELETE | `/api/workspaces/{id}`  | Delete a workspace       |

### Workspace Lifecycle

| Method | Path                            | Description        |
|--------|---------------------------------|--------------------|
| POST   | `/api/workspaces/{id}/start`    | Start a workspace  |
| POST   | `/api/workspaces/{id}/stop`     | Stop a workspace   |

## Open Questions

- [ ] What fields does Workspace need? Minimum viable vs future-proof?
- [ ] Do we need a separate Image entity, or is image just a string field on Workspace?
- [ ] Workspace naming -- user-provided slug or auto-generated ID?
- [ ] Should status transitions be enforced in the model or in the service layer?
- [ ] Do we need `port` as a separate entity, or are ports always the fixed 8081-8085 range?
- [ ] Runtime field on workspace (tart/incus) -- needed, or inferred from the host?
- [ ] API versioning -- `/api/v1/` from the start, or just `/api/`?
- [ ] TypeSpec project structure -- where does the `.tsp` file live?
