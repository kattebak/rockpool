# EDD: Package Structure & Service Layer

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Draft      |
| Created | 2026-02-22 |
| Updated | 2026-02-22 |

## Summary

Defines the npm workspace package layout and the repository pattern used for external integrations. Each integration (VM runtime, Caddy, queue, database) lives in a dedicated package that exports a clean interface. The control plane server composes these via dependency injection.

## Prerequisites

- [ADR-007: npm workspaces monorepo](../ADR/007-npm-workspaces-monorepo.md)
- [ADR-008: Native-first, minimal dependencies](../ADR/008-native-first-minimal-dependencies.md)
- [ADR-014: Build tooling conventions](../ADR/014-build-tooling-conventions.md)
- [EDD 001: Architecture Overview](001_Architecture_Overview.md)
- [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md)
- [EDD 007: Data Model](007_Data_Model.md)

## Package Layout

```
rockpool/
├── typespec/                    # TypeSpec source (.tsp files), not an npm workspace
├── build/                       # Generated artifacts (@rockpool/openapi, @rockpool/validators, @rockpool/enums, @rockpool/db-schema, @rockpool/sdk)
├── packages/
│   ├── db/                      # Drizzle schema + migrations + connection
│   ├── runtime/                 # VM runtime adapters (Tart now, Incus later)
│   ├── caddy/                   # Caddy admin API client
│   ├── queue/                   # SQS/ElasticMQ client
│   ├── server/                  # Express control plane
│   ├── worker/                  # Async workspace lifecycle (ElasticMQ consumer)
│   └── client/                  # React SPA
├── npm-scripts/                 # Reusable operational scripts (ADR-014)
├── Makefile                     # Build artifacts (ADR-014)
└── package.json                 # Root: workspaces = ["packages/*"]
```

### Package Descriptions

**`typespec/`** -- TypeSpec source definitions. Compiles to OpenAPI, Zod, TS types, and Drizzle tables. Output lands in `build/` as package-style artifacts. Not a workspace; it is built via the Makefile and npm scripts.

**`build/`** -- Generated artifacts (gitignored). Contains `@rockpool/openapi`, `@rockpool/validators`, `@rockpool/enums`, `@rockpool/db-schema`, and `@rockpool/sdk` as file-based packages. Consumed by `server`, `worker`, `client`, and `db` via `file:build/...` dependencies.

**`packages/db/`** -- Database layer. Contains Drizzle table definitions (generated from TypeSpec), hand-written migrations, and the connection factory. Exports typed query helpers. Consumed by `server`.

**`packages/runtime/`** -- VM runtime adapters. Exports a `RuntimeRepository` interface and the `TartRuntime` (macOS, CLI wrapper). `IncusRuntime` is planned for a later phase. The server selects the adapter based on host configuration once Linux support is added.

**`packages/caddy/`** -- Caddy admin API client. Exports a `CaddyRepository` interface for managing routes (add, remove, list). Talks to the Caddy admin API on `localhost:2019`. Consumed by `server`.

**`packages/queue/`** -- Message queue client. Exports a `QueueRepository` interface for sending and receiving jobs. Backed by ElasticMQ (SQS-compatible). Consumed by `server` for enqueuing workspace lifecycle jobs and by `worker` for dequeuing them.

**`packages/server/`** -- Express control plane. Composes integration packages (`db`, `runtime`, `caddy`, `queue`). Contains the Workspace Service and Caddy Service described in [EDD-001](001_Architecture_Overview.md). Owns business logic, API routes, and status transitions ([EDD-007](007_Data_Model.md)).

**`packages/worker/`** -- Async workspace lifecycle processor. Consumes jobs from the queue, drives VM creation/teardown via `RuntimeRepository`, configures routes via `CaddyRepository`, and updates workspace status via `db`. Runs as a separate process from the server.

**`packages/client/`** -- React SPA. Consumes build artifacts for API types and schemas. Served at `/app/*`.

## Repository Pattern

Each integration package exports a repository interface -- a thin contract that hides the implementation details of the external system. The server depends on the interface, not the implementation.

### Interface Shape

Repositories follow a consistent pattern:

```typescript
interface RuntimeRepository {
  create(name: string, image: string): Promise<void>;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  remove(name: string): Promise<void>;
  status(name: string): Promise<VmStatus>;
  getIp(name: string): Promise<string>;
}

interface CaddyRepository {
  addWorkspaceRoute(name: string, vmIp: string): Promise<void>;
  removeWorkspaceRoute(name: string): Promise<void>;
  listRoutes(): Promise<Route[]>;
}

interface QueueRepository {
  send(job: WorkspaceJob): Promise<void>;
  receive(): Promise<WorkspaceJob | null>;
  delete(receiptHandle: string): Promise<void>;
}
```

These are illustrative -- exact signatures will be defined in the packages themselves.

### Composition

The server composes repositories at startup:

```typescript
import { createTartRuntime } from "@rockpool/runtime";
import { createCaddyRepository } from "@rockpool/caddy";
import { createQueueRepository } from "@rockpool/queue";
import { createDb } from "@rockpool/db";

const runtime = createTartRuntime();

const caddy = createCaddyRepository({ adminUrl: "http://localhost:2019" });
const queue = createQueueRepository({ endpoint: config.queueEndpoint });
const db = createDb({ path: config.dbPath });
```

Services receive their dependencies as constructor arguments, not global imports. This keeps services testable and integration packages swappable.

## Dependency Graph

```
typespec/
  │ generates
  ▼
build/ (@rockpool/openapi, @rockpool/validators, @rockpool/enums, @rockpool/db-schema, @rockpool/sdk)
  │
  ▼
packages/db/
   │
   ├──────────────────────────┐
   ▼                          ▼
packages/server/         packages/worker/
   │ depends on              │ depends on
   ├── packages/db/          ├── packages/db/
   ├── packages/runtime/     ├── packages/runtime/
   ├── packages/caddy/       ├── packages/caddy/
   └── packages/queue/       └── packages/queue/
```

No circular dependencies. Integration packages (`runtime`, `caddy`, `queue`) are leaf nodes -- they depend only on `types` (for shared type definitions) and external libraries. `server` and `worker` are both top-level consumers that compose integration packages but do not depend on each other.

## Workspace Configuration

Root `package.json` registers all workspaces:

```json
{
  "workspaces": ["packages/*"]
}
```

Cross-package references use the workspace protocol:

```json
{
  "dependencies": {
    "@rockpool/db-schema": "file:build/db-schema",
    "@rockpool/enums": "file:build/enums",
    "@rockpool/openapi": "file:build/openapi",
    "@rockpool/sdk": "file:build/sdk",
    "@rockpool/validators": "file:build/validators"
  }
}
```

Package naming convention: `@rockpool/<name>` scoped packages.

## Decisions

| Question                                 | Decision                                                       | Rationale                                                                                                                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime: one package or two?             | One `runtime` package, Incus later                             | Keep the interface stable while deferring Linux support                                                                                                                                                                                    |
| Where do generated types go?             | `build/` packages                                              | Derived artifacts, gitignored, regenerated by `make`. No checked-in generated code.                                                                                                                                                        |
| TypeSpec: inside `packages/` or at root? | `typespec/` at root (not a workspace)                          | Separate toolchain, built via Makefile, not a runtime dependency                                                                                                                                                                           |
| Package scope                            | `@rockpool/*`                                                      | Avoids name collisions, clean import paths                                                                                                                                                                                                 |
| Worker: in server or separate?           | Separate `packages/worker/`, but embeddable in-process for dev | Production: independent process with SQS. Dev mode (`NODE_ENV=test`): server runs worker poll loop in-process with shared MemoryQueue, no separate process needed.                                                                         |
| Integration testing                      | Each package owns its own tests                                | Repository pattern makes each package independently testable with stubs for external systems                                                                                                                                               |
| Dev mode stubs                           | StubRuntime + StubCaddy                                        | `@rockpool/runtime` exports `createStubRuntime()` (in-memory VM simulation with auto-incrementing IPs). `@rockpool/caddy` exports `createStubCaddy()` (no-op). Server uses stubs when `NODE_ENV=test` (override with `RUNTIME=tart` for real VMs). |
