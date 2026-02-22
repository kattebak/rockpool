# EDD: Workspace Service Refactor

| Field        | Value                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Author       | mvhenten                                                                                                                                                                 |
| Status       | Draft                                                                                                                                                                    |
| Created      | 2026-02-22                                                                                                                                                               |
| Updated      | 2026-02-22                                                                                                                                                               |
| Related ADRs | [ADR-009](../ADR/009-sqlite-drizzle-orm.md), [ADR-008](../ADR/008-native-first-minimal-dependencies.md)                                                                 |
| Related EDDs | [EDD-001](001_Architecture_Overview.md), [EDD-002](002_MicroVM_Runtime.md), [EDD-003](003_Caddy_Reverse_Proxy.md), [EDD-007](007_Data_Model.md), [EDD-008](008_Package_Structure.md) |

## Summary

Refactor the workspace service from a thin CRUD + queue layer into the single authority on workspace runtime state. Today, the worker (`@rockpool/worker`) directly calls `RuntimeRepository`, `CaddyRepository`, and DB queries to manage VM lifecycle. The workspace service (`@rockpool/server/services/workspace-service.ts`) only validates state transitions and enqueues jobs. This split means two packages share responsibility for the same domain, and the server has no way to answer "is this workspace actually running?" without trusting stale DB state.

This EDD describes how to consolidate runtime authority into a standalone `@rockpool/workspace-service` package, add lazy on-demand restart when Caddy receives a request for a stopped workspace, serve a loading page during VM spinup, and make Caddy routes fully ephemeral (rebuilt on demand, never bulk-recovered at startup).

## Prerequisites

- [EDD-001](001_Architecture_Overview.md) -- architecture overview, control plane layout
- [EDD-002](002_MicroVM_Runtime.md) -- Tart runtime, `RuntimeRepository` interface
- [EDD-003](003_Caddy_Reverse_Proxy.md) -- Caddy route management, origin isolation
- [EDD-007](007_Data_Model.md) -- workspace state machine, DB schema
- [EDD-008](008_Package_Structure.md) -- package layout, repository pattern

## Problem Statement

### Current Architecture

```
                API Request
                    |
                    v
         +---------+---------+
         | workspace-service |   (thin CRUD + queue)
         | packages/server/  |
         | services/         |
         +--------+----------+
                  | enqueue
                  v
         +--------+----------+
         |    @rockpool/     |   (direct DB + runtime + caddy)
         |      worker       |
         +-------------------+
```

**workspace-service** (in `packages/server/src/services/workspace-service.ts`) currently:
- Validates state transitions via `VALID_TRANSITIONS` map
- Checks concurrency limits (max 3 concurrent starts, max 999 workspaces)
- Creates DB records and enqueues jobs on the queue
- Has no access to `RuntimeRepository` or `CaddyRepository`

**worker** (in `packages/worker/src/processor.ts`) currently:
- Receives jobs from the queue
- Calls `RuntimeRepository` directly (create, start, stop, remove, getIp, configure)
- Calls `CaddyRepository` directly (addWorkspaceRoute, removeWorkspaceRoute)
- Updates DB status directly via `@rockpool/db` query functions
- Contains the health check loop (curl-based)

**server startup** (`packages/server/src/index.ts`) currently:
- Runs `recoverRunningWorkspaces()` at boot: iterates all DB-status-running workspaces, checks VM state, re-adds Caddy routes or re-enqueues start jobs
- Runs `recoverOrphanedWorkspaces()` at boot: re-enqueues jobs for "creating" workspaces

### Problems

1. **Split authority**: Two packages (server + worker) both write to the DB and manage infrastructure. The workspace-service cannot answer "is this VM actually running?" -- it only knows what the DB says.

2. **Eager recovery at startup**: The server bulk-recovers all Caddy routes on boot. If the server restarts, it iterates every running workspace to re-add routes. This is O(n) on startup and races with the worker.

3. **No lazy restart**: If a workspace is stopped and the user navigates to its URL, Caddy has no route and returns 404. The user must explicitly start the workspace through the API before accessing it.

4. **No loading page**: When a workspace is starting (VM booting, code-server initializing), there is nothing to show the user. The workspace URL either 404s (no route) or 502s (route exists but code-server is not ready).

5. **Caddy routes are treated as durable**: The current code tries to keep Caddy routes in sync with DB state. But Caddy routes are ephemeral -- lost on restart. The reconciliation logic (recovery functions in `index.ts`) is complex and error-prone.

## Design

### Principle: Workspace Service as Single Authority

The workspace service becomes the sole owner of workspace lifecycle. It owns `RuntimeRepository`, `CaddyRepository`, and DB access. The worker becomes a thin job executor that calls workspace-service methods.

```
                API Request           Caddy Route Hit
                    |                      |
                    v                      v
         +---------+----------+    +-------+--------+
         |   API routes       |    | Caddy fallback |
         |   (packages/       |    | route (server) |
         |    server)         |    +-------+--------+
         +--------+-----------+            |
                  |                        |
                  v                        v
         +--------+------------------------+--------+
         |          @rockpool/workspace-service      |
         |                                           |
         |  - State machine + transitions            |
         |  - RuntimeRepository (VM lifecycle)       |
         |  - CaddyRepository (route management)     |
         |  - DB queries (status, vmIp, ports)       |
         |  - Health check                           |
         |  - Concurrency limits                     |
         +-------------------------------------------+
                  |
                  v
         +--------+----------+
         |    @rockpool/     |   (thin: dequeue -> call service)
         |      worker       |
         +-------------------+
```

### Principle: Lazy Route Reconstruction

Caddy routes are not recovered at startup. Instead, Caddy gets a fallback route that catches all `/workspace/*` requests and proxies them to the control plane. The control plane checks workspace state and either:
- Adds the route and proxies through (if the workspace is running and has a known IP)
- Starts the VM and returns a loading page (if the workspace is stopped)
- Returns 404 (if the workspace does not exist)

This eliminates the startup recovery loop entirely. Routes are added on demand, one at a time, on first request.

### Principle: Loading Page on Wake

When a stopped workspace receives a request, the server returns an HTML loading page that polls for readiness. Once the workspace is running and the Caddy route is in place, the page redirects to the workspace URL (which now goes through Caddy directly to the VM).

## Package Layout

### New: `packages/workspace-service/`

A new package `@rockpool/workspace-service` that owns the workspace domain.

```
packages/workspace-service/
  src/
    index.ts                 # public exports
    workspace-service.ts     # main service factory
    types.ts                 # WorkspaceServiceDeps, WorkspaceService type
    health-check.ts          # curl-based health check (moved from worker)
    loading-page.ts          # HTML template for the loading/splash page
  test/
    workspace-service.test.ts
  package.json
```

### Changes to existing packages

**`packages/server/`**:
- Remove `services/workspace-service.ts` (moved to `@rockpool/workspace-service`)
- Keep `services/port-service.ts` (ports are a sub-resource, stays in server for now)
- Add a fallback route handler for `/workspace/*` that calls workspace-service
- `index.ts` loses `recoverRunningWorkspaces()` and `recoverOrphanedWorkspaces()`
- Imports `@rockpool/workspace-service` instead of defining it locally

**`packages/worker/`**:
- `processor.ts` becomes a thin dispatcher: dequeue job, call workspace-service method, report result
- Loses direct `RuntimeRepository`, `CaddyRepository`, and DB access
- Only depends on `@rockpool/workspace-service` and `@rockpool/queue`

**`packages/caddy/`**:
- Add `hasWorkspaceRoute(name: string): Promise<boolean>` to `CaddyRepository` -- checks if a route exists via GET on the admin API
- No other changes to the interface

## Workspace Service Interface

```typescript
interface WorkspaceService {
  // CRUD (existing)
  list(params?: PaginationParams): Promise<PaginatedResult<Workspace>>;
  get(id: string): Promise<Workspace | undefined>;
  create(name: string, image: string): Promise<Workspace>;
  remove(id: string): Promise<void>;

  // Lifecycle (existing, but now does the actual work)
  start(id: string): Promise<Workspace>;
  stop(id: string): Promise<Workspace>;

  // Runtime operations (new, called by worker)
  provisionAndStart(id: string): Promise<Workspace>;
  teardown(id: string): Promise<void>;

  // Route management (new, called by fallback route handler)
  ensureRoute(name: string): Promise<EnsureRouteResult>;
}

type EnsureRouteResult =
  | { status: "routed"; vmIp: string }
  | { status: "starting"; workspaceId: string }
  | { status: "not_found" };
```

### Method Responsibilities

**`create(name, image)`** -- unchanged externally. Validates name uniqueness, concurrency limits, creates DB record in "creating" status, enqueues a "create" job.

**`start(id)`** -- validates state transition (stopped -> creating), updates DB, enqueues "start" job. Unchanged externally.

**`stop(id)`** -- validates state transition (running -> stopping), updates DB, enqueues "stop" job. Unchanged externally.

**`remove(id)`** -- validates workspace is not running/creating, enqueues "delete" job. Unchanged externally.

**`provisionAndStart(id)`** -- called by the worker for "create" and "start" jobs. This is where the actual runtime work happens:
1. Check VM status via `RuntimeRepository.status()`
2. Create VM if not found, start VM if stopped, skip if already running
3. Get VM IP via `RuntimeRepository.getIp()`
4. Configure VM via `RuntimeRepository.configure()` (code-server base path)
5. Wait for health check (curl-based, moved from worker)
6. Add Caddy route via `CaddyRepository.addWorkspaceRoute()`
7. Update DB status to "running" with vmIp

**`teardown(id)`** -- called by the worker for "stop" and "delete" jobs:
- For stop: remove ports from DB, stop VM, remove Caddy route, update DB to "stopped"
- For delete: stop VM (ignore errors), remove VM, remove Caddy route, delete DB record

**`ensureRoute(name)`** -- called by the fallback route handler when Caddy does not have a route for a workspace. This is the lazy restart entry point:
1. Look up workspace by name in DB
2. If not found: return `{ status: "not_found" }`
3. If status is "running" and vmIp is set: add Caddy route, return `{ status: "routed", vmIp }`
4. If status is "stopped": transition to "creating", enqueue "start" job, return `{ status: "starting", workspaceId }`
5. If status is "creating" or "stopping": return `{ status: "starting", workspaceId }` (already in progress)
6. If status is "error": return `{ status: "starting", workspaceId }` and re-enqueue (auto-retry)

### Dependencies

```typescript
interface WorkspaceServiceDeps {
  db: DbClient;
  queue: QueueRepository;
  runtime: RuntimeRepository;
  caddy: CaddyRepository;
  logger: Logger;
  healthCheck?: HealthCheckFn;
}
```

The workspace service now receives all infrastructure dependencies, unlike the current version which only has `db` and `queue`.

## Lazy Restart Flow

### Caddy Fallback Route

At bootstrap, the server adds a catch-all fallback route on srv1 with a very low priority (appended last to the route array). This route matches any `/workspace/*` request that was not caught by a specific workspace route.

```json
{
  "@id": "workspace-fallback",
  "match": [{ "path": ["/workspace/*"] }],
  "handle": [
    {
      "handler": "reverse_proxy",
      "upstreams": [{ "dial": "localhost:7163" }],
      "headers": {
        "request": {
          "set": {
            "X-Rockpool-Fallback": ["true"]
          }
        }
      }
    }
  ],
  "terminal": true
}
```

This route proxies the request to the control plane API server with an `X-Rockpool-Fallback` header so the server knows this is a fallback hit, not a direct API call.

### Server Fallback Handler

The server registers a route handler that catches requests with the `X-Rockpool-Fallback` header:

```
GET /workspace/:name/*
  if X-Rockpool-Fallback header present:
    result = workspaceService.ensureRoute(name)
    switch result.status:
      "routed":   302 redirect to same URL (Caddy now has the route)
      "starting": return loading page HTML
      "not_found": return 404
```

The redirect after "routed" causes the browser to re-request the URL. This time Caddy has the workspace-specific route and proxies directly to the VM, bypassing the fallback entirely. The redirect is invisible to the user.

### Full Sequence: User Navigates to a Stopped Workspace

```
Browser                 Caddy (srv1)           Server              Worker
   |                       |                     |                    |
   |-- GET /workspace/foo/ |                     |                    |
   |                       |                     |                    |
   |    (no workspace-foo  |                     |                    |
   |     route exists)     |                     |                    |
   |                       |                     |                    |
   |                       |-- proxy via ------->|                    |
   |                       |   fallback route    |                    |
   |                       |                     |                    |
   |                       |                     |-- ensureRoute("foo")
   |                       |                     |   DB: status=stopped
   |                       |                     |   -> transition to "creating"
   |                       |                     |   -> enqueue "start" job
   |                       |                     |   -> return { status: "starting" }
   |                       |                     |                    |
   |<-- 200 loading page --|<--------------------|                    |
   |                       |                     |                    |
   |    (page polls        |                     |                    |
   |     GET /api/workspaces/:id                 |                    |
   |     every 2s)         |                     |                    |
   |                       |                     |    (dequeues job)  |
   |                       |                     |                    |
   |                       |                     |<-- provisionAndStart()
   |                       |                     |    start VM        |
   |                       |                     |    wait for health |
   |                       |                     |    add Caddy route |
   |                       |                     |    update DB       |
   |                       |                     |                    |
   |    (poll returns      |                     |                    |
   |     status: running)  |                     |                    |
   |                       |                     |                    |
   |-- GET /workspace/foo/ |                     |                    |
   |                       |                     |                    |
   |    (workspace-foo     |                     |                    |
   |     route NOW exists) |                     |                    |
   |                       |                     |                    |
   |                       |-- proxy to VM ----->|                    |
   |<-- 200 IDE content ---|<--(from VM)---------|                    |
```

### Full Sequence: User Navigates to a Running Workspace (After Server Restart)

When the server restarts, all Caddy routes are gone (Caddy also restarts via PM2). On first request:

```
Browser                 Caddy (srv1)           Server
   |                       |                     |
   |-- GET /workspace/foo/ |                     |
   |                       |                     |
   |                       |-- proxy via ------->|
   |                       |   fallback route    |
   |                       |                     |
   |                       |                     |-- ensureRoute("foo")
   |                       |                     |   DB: status=running, vmIp=10.0.1.50
   |                       |                     |   -> addWorkspaceRoute("foo", "10.0.1.50")
   |                       |                     |   -> return { status: "routed" }
   |                       |                     |
   |<-- 302 redirect ------|<--------------------|
   |                       |                     |
   |-- GET /workspace/foo/ |                     |
   |                       |                     |
   |                       |-- proxy to VM ----->|
   |<-- 200 IDE content ---|                     |
```

No startup recovery loop. The first user request triggers route creation. Subsequent requests go directly through Caddy.

## Loading Page

The loading page is a minimal, self-contained HTML page served by the control plane when a workspace is starting. It requires no external assets (no CSS files, no JS bundles) -- everything is inlined.

### Behavior

1. Display workspace name and a "starting" status indicator
2. Poll `GET /api/workspaces/:id` every 2 seconds
3. When status becomes "running", redirect to the workspace URL
4. If status becomes "error", show the error message with a retry button
5. If the workspace is not found (deleted while starting), show a "workspace not found" message

### Implementation

The loading page is a template function in `@rockpool/workspace-service` that takes the workspace name and ID and returns an HTML string:

```typescript
function renderLoadingPage(workspaceName: string, workspaceId: string): string
```

The HTML includes:
- Inline CSS for a centered loading indicator
- Inline JavaScript for the polling loop
- The workspace name as visible text
- The API endpoint URL for polling
- The target workspace URL for redirect on ready

### Constraints

- No external dependencies (fonts, CSS frameworks, JS libraries)
- Works without cookies or authentication (the loading page is served through the authenticated Caddy route)
- Accessible: works without JavaScript (shows a "refresh this page" fallback message in a `<noscript>` block)
- Uses the same visual language as the SPA (colors, typography) but is self-contained

## Worker Refactor

The worker processor becomes a thin dispatcher:

```typescript
// packages/worker/src/processor.ts (after refactor)

interface ProcessorDeps {
  workspaceService: WorkspaceService;
  logger: Logger;
}

function createProcessor(deps: ProcessorDeps) {
  const { workspaceService, logger } = deps;

  return {
    async process(job: WorkspaceJob): Promise<void> {
      switch (job.type) {
        case "create":
        case "start":
          await workspaceService.provisionAndStart(job.workspaceId);
          break;
        case "stop":
          await workspaceService.teardown(job.workspaceId);
          break;
        case "delete":
          await workspaceService.teardown(job.workspaceId);
          break;
      }
    },
  };
}
```

Error handling (setting workspace to "error" status on failure) moves into the workspace service's `provisionAndStart` and `teardown` methods, or remains in the processor as a catch-all. The key change is that the worker no longer imports `@rockpool/runtime`, `@rockpool/caddy`, or `@rockpool/db`.

## Self-Healing

### Route-Level Self-Healing (Lazy)

Every workspace request that hits the fallback route triggers `ensureRoute()`. This is continuous, per-workspace self-healing with zero startup cost.

Scenarios handled:
- **Caddy restarted**: all routes lost, rebuilt on first request per workspace
- **Server restarted**: same as above, server just needs DB
- **VM crashed**: DB says running, but `ensureRoute()` finds no VM. Re-enqueue start.
- **Stale vmIp**: DB says running with old IP, Caddy route added but 502s. The user sees the loading page, polls, and the system detects the mismatch.

### Status Verification in `ensureRoute()`

When the DB says a workspace is "running" and has a vmIp, `ensureRoute()` can optionally verify the VM is actually running before adding the route:

```
ensureRoute(name):
  workspace = getWorkspaceByName(name)
  if workspace.status == "running" && workspace.vmIp:
    vmStatus = runtime.status(workspace.name)
    if vmStatus == "running":
      caddy.addWorkspaceRoute(name, workspace.vmIp)
      return { status: "routed" }
    else:
      // VM died, DB is stale
      updateWorkspaceStatus(id, "stopped")
      // fall through to the "stopped" case below
```

This adds one runtime status check per first request, which is acceptable since it only happens once per workspace after a restart.

### Orphaned "Creating" Workspaces

Workspaces stuck in "creating" (worker crashed mid-provision) are handled by `ensureRoute()` returning `{ status: "starting" }`. The loading page polls until the workspace either reaches "running" or "error". If the user navigates to a workspace that has been "creating" for too long, the loading page shows it.

A background sweep (optional, can be added later) checks for workspaces that have been "creating" for more than 10 minutes and transitions them to "error".

## State Machine Updates

The existing state machine from [EDD-007](007_Data_Model.md) remains unchanged. The transitions are:

```
creating -> running   (provision success)
creating -> error     (provision failure)
running  -> stopping  (user stops)
stopping -> stopped   (stop success)
stopping -> error     (stop failure)
stopped  -> creating  (user starts or lazy restart)
error    -> creating  (retry)
```

The new behavior is that the `stopped -> creating` transition can be triggered by:
1. `POST /api/workspaces/:id/start` (explicit, user-initiated)
2. `ensureRoute(name)` (implicit, on first Caddy request to a stopped workspace)

Both paths enqueue the same "start" job.

## Port Service Integration

The port service (`packages/server/src/services/port-service.ts`) currently depends on `CaddyRepository` directly to add/remove port routes. After the refactor, it continues to manage port Caddy routes directly -- ports are a sub-resource of a running workspace, and the port service already validates that the workspace is running before modifying routes.

The port service does not move into `@rockpool/workspace-service`. Ports are a UI concern (register/unregister forwarded ports for browser access), not a core lifecycle concern. Keeping them in the server package avoids bloating the workspace service with HTTP routing logic.

Port routes on srv2 follow the same lazy pattern as workspace routes on srv1: a fallback route on srv2 catches unmatched `/workspace/*/port/*` requests and proxies to the control plane. The server checks if the workspace is running and the port is registered, then adds the route and redirects (or returns 404).

## Migration Plan

The refactor is broken into ordered phases. Each phase produces a working system that passes all existing tests.

### Phase 1: Extract workspace-service package

**What moves:**
- `packages/server/src/services/workspace-service.ts` -> `packages/workspace-service/src/workspace-service.ts`
- Health check logic from `packages/worker/src/processor.ts` -> `packages/workspace-service/src/health-check.ts`
- `NotFoundError` and `ConflictError` classes -> `packages/workspace-service/src/errors.ts`

**What stays:**
- `packages/server/src/services/port-service.ts` stays in server
- `packages/server/src/routes/*` stays in server

**New dependencies for workspace-service:**
- `@rockpool/db`
- `@rockpool/queue`
- `@rockpool/runtime`
- `@rockpool/caddy`
- `pino`

**Server changes:**
- `packages/server/src/index.ts` imports `createWorkspaceService` from `@rockpool/workspace-service`
- Passes `runtime` and `caddy` as additional deps to workspace-service factory
- Server no longer creates runtime/caddy separately for recovery -- workspace-service owns them

**Acceptance criteria:**
- `npm run check` passes
- `npm run lint` passes
- All existing tests pass (server API tests, worker processor tests)
- `npm run test` succeeds across all workspaces

### Phase 2: Move runtime operations into workspace-service

**What changes:**
- Add `provisionAndStart(id)` and `teardown(id)` methods to workspace-service
- These contain the logic currently in `processor.ts` handlers (handleCreate, handleStart, handleStop, handleDelete)
- Worker processor becomes a thin dispatcher that calls workspace-service methods

**Worker changes:**
- `processor.ts` drops direct `RuntimeRepository`, `CaddyRepository`, `DbClient` deps
- `ProcessorDeps` becomes `{ workspaceService: WorkspaceService; logger: Logger }`
- Error handling (catch + set error status) stays in processor or moves to workspace-service

**Acceptance criteria:**
- Worker processor tests rewritten to mock workspace-service instead of runtime/caddy/db
- All existing behavior preserved (idempotent create, stop with port cleanup, delete, error handling)
- `npm run test` passes

### Phase 3: Add fallback route and `ensureRoute()`

**What changes:**
- Add `ensureRoute(name)` method to workspace-service
- Add `hasWorkspaceRoute(name)` to `CaddyRepository` interface and implementations
- Add fallback route to Caddy bootstrap config (in `@rockpool/caddy` buildBootstrapConfig)
- Add fallback route handler in server (`GET /workspace/:name/*` with X-Rockpool-Fallback check)
- Add loading page template to `@rockpool/workspace-service`

**What gets removed:**
- `recoverRunningWorkspaces()` from `packages/server/src/index.ts`
- `recoverOrphanedWorkspaces()` from `packages/server/src/index.ts`

**Acceptance criteria:**
- Navigating to a running workspace URL (after server restart) adds the route and redirects
- Navigating to a stopped workspace URL returns the loading page
- Loading page polls and redirects when workspace becomes running
- Navigating to a nonexistent workspace URL returns 404
- No startup recovery loop
- `npm run test` passes

### Phase 4: Loading page polish and error handling

**What changes:**
- Loading page shows error state when workspace transitions to "error"
- Loading page shows retry button on error
- Loading page handles workspace deletion (404 from API poll)
- Add timeout: if workspace is still "creating" after 5 minutes of polling, show timeout message

**Acceptance criteria:**
- Error scenarios produce user-visible feedback
- Loading page is accessible (works without JS via noscript fallback)
- `npm run test` passes

## What to Commit Now vs. Later

### Commit now (from the previous session's uncommitted work)

The uncommitted changes from the previous session include useful improvements that are independent of this refactor:

- `packages/worker/src/processor.ts` -- curl health check, idempotent create/start handlers
- `packages/worker/test/processor.test.ts` -- tests for idempotent handlers
- `packages/db/src/queries.ts` + `packages/db/src/index.ts` -- `listWorkspacesByStatus` query
- `packages/server/src/services/workspace-service.ts` -- error -> creating transition
- `npm-scripts/preflight.sh` -- startup preflight check
- `package.json` -- prestart script
- `.claude/agents/architect.md` + `.claude/agents/developer.md` -- "check logs first" guidance

These changes are additive and do not conflict with the refactor. They should be committed as-is to establish the baseline.

### Defer to the refactor

- Recovery functions in `packages/server/src/index.ts` (`recoverRunningWorkspaces`, `recoverOrphanedWorkspaces`) -- these will be removed entirely in Phase 3
- Any changes to package structure or new packages

## Testing Strategy

### Unit Tests (`packages/workspace-service/test/`)

- State transition validation (same as current workspace-service tests)
- Concurrency limit enforcement
- `provisionAndStart()` with mock runtime/caddy/db (mirrors current processor tests)
- `teardown()` with mock runtime/caddy/db
- `ensureRoute()` scenarios: running workspace, stopped workspace, nonexistent, error state, creating state
- Loading page template renders valid HTML

### Integration Tests (`packages/server/test/`)

- API endpoints work with the extracted workspace-service
- Fallback route handler returns loading page for stopped workspaces
- Fallback route handler returns 404 for nonexistent workspaces
- Fallback route handler adds route and redirects for running workspaces

### Worker Tests (`packages/worker/test/`)

- Processor dispatches to workspace-service methods
- Error handling sets workspace to error state

## Dependency Graph (After Refactor)

```
typespec/ -> build/ (generated)

packages/workspace-service/
  depends on: @rockpool/db, @rockpool/queue,
              @rockpool/runtime, @rockpool/caddy

packages/server/
  depends on: @rockpool/workspace-service,
              @rockpool/db, @rockpool/caddy  (port-service still needs these)

packages/worker/
  depends on: @rockpool/workspace-service,
              @rockpool/queue
```

The worker no longer depends on `@rockpool/runtime`, `@rockpool/caddy`, or `@rockpool/db`. It only talks to the workspace service and the queue.

## Decisions

| Question | Decision | Rationale |
| --- | --- | --- |
| Where does workspace-service live? | `packages/workspace-service/` as its own npm workspace | Clean separation, testable independently, shared by server and worker |
| Does port-service move? | No, stays in server | Ports are a UI concern, not core lifecycle |
| How are routes recovered after restart? | Lazily on first request, not at startup | Eliminates O(n) startup cost, simpler, self-healing |
| What replaces bulk recovery? | Caddy fallback route + `ensureRoute()` | Every workspace request self-heals its own route |
| Loading page technology? | Inline HTML served by Express | No external assets, no SPA dependency, self-contained |
| Does `ensureRoute()` verify VM status? | Yes, one runtime.status() call per first request | Catches stale DB state, acceptable cost |
| Error handling location | Processor catches errors and calls workspace-service error method | Worker is the execution boundary, sets error status on failure |
| Health check location | `@rockpool/workspace-service/src/health-check.ts` | Collocated with the lifecycle methods that use it |

## Open Questions

- [ ] Should `ensureRoute()` also recover port routes, or only the workspace route? (Ports could be lazily recovered by the port-service fallback on srv2.)
- [ ] Should the loading page be served from the workspace-service package or from a static HTML file in the server? (Current design: template function in workspace-service.)
- [ ] Should there be a configurable idle timeout that auto-stops workspaces? (Deferred -- mentioned in EDD-001 open questions.)
- [ ] Should `provisionAndStart()` be idempotent if called concurrently for the same workspace? (Current design: yes, via runtime status check + Caddy route upsert.)
