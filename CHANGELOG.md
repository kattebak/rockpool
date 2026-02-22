# Changelog

All notable changes to the Tidepool project are documented here.

## [Unreleased]

### Nested Subroutes for Port Forwarding

Refactored Caddy port forwarding routes from flat top-level srv1 routes to nested
subroutes inside the workspace route, matching the EDD-003 specification. Port routes
are now children of the workspace's subroute handler, so deleting a workspace route
cascades to all its port routes automatically.

#### Changed

- **`addPortRoute()`** in `@tdpl/caddy` — POSTs to
  `/id/workspace-{name}/handle/0/routes` (the workspace's nested subroute array)
  instead of `/config/apps/http/servers/srv1/routes` (top-level).
- **`buildWorkspaceRoute()`** in `@tdpl/caddy` — Added `X-Forwarded-Prefix` header
  on the workspace reverse proxy handler, matching what port routes already had.
- **`handleStop()` / `handleDelete()`** in `@tdpl/worker` — Removed explicit
  `removePortRoutes()` loop. Caddy cascades port route deletion when the parent
  workspace route is removed.

### PM2 Process Management

Replaced bash-based dev process management with PM2 ecosystem config files
per EDD-010. Dev workflows now use `pm2 start` / `pm2 logs` instead of
hand-rolled PID arrays and trap handlers.

#### Added

- **`ecosystem.config.cjs`** -- PM2 dev mode config (server + client). Server
  runs with `NODE_ENV=test` (MemoryQueue, StubRuntime, StubCaddy, in-process
  worker). Client dev server proxies `/api/*` to `:7163`. Both processes
  auto-restart on crash with file watching on `packages/server/src`.
- **`ecosystem.caddy.config.cjs`** -- PM2 dev+caddy mode config (caddy + server).
  Caddy runs as a non-Node process (`interpreter: "none"`). Server runs with
  `WORKER_INLINE=true`, `SPA_ROOT`, and `SSH_KEY_PATH` resolved to absolute paths.
- **`dev:stop`** script -- `pm2 delete all` for clean shutdown.
- **`dev:status`** script -- `pm2 status` for process table view.
- **`dev:logs`** script -- `pm2 logs` for tailing process output.
- **`pm2` devDependency** -- Added to root `package.json`.

#### Removed

- **`npm-scripts/dev.sh`** -- Replaced by `ecosystem.config.cjs`.
- **`npm-scripts/dev-caddy.sh`** -- Replaced by `ecosystem.caddy.config.cjs`.

#### Changed

- **`npm run dev`** -- Now runs `pm2 start ecosystem.config.cjs && pm2 logs`.
- **`npm run dev:caddy`** -- Now builds client, then runs
  `pm2 start ecosystem.caddy.config.cjs && pm2 logs`.

### X-Forwarded-Prefix on Workspace Routes

Added `X-Forwarded-Prefix` header to workspace routes in the Caddy client,
matching what was already done for port routes. This tells code-server (and
other backends) their path context so they can generate correct URLs.

#### Fixed

- **`buildWorkspaceRoute()`** in `@tdpl/caddy` now sets
  `X-Forwarded-Prefix: ["/workspace/{name}"]` on the `reverse_proxy` handler
  inside the subroute. Previously only port routes had this header, meaning
  code-server relied solely on `--abs-proxy-base-path` for URL generation.

### Workspace Caps and Concurrency Limits

Enforced server-side limits from EDD-007: max 999 workspaces per host, max 3
concurrent workspace starts. Requests that exceed these caps are rejected with
409 Conflict.

#### Added

- **`countWorkspaces()`** query in `@tdpl/db` -- Returns total workspace count.
- **`countWorkspacesByStatus()`** query in `@tdpl/db` -- Returns count of
  workspaces in a given status (e.g. "creating").
- **Max workspace count check** -- `workspace-service.create()` rejects with
  409 when 999 workspaces exist.
- **Max concurrent starts check** -- `workspace-service.create()` and
  `workspace-service.start()` reject with 409 when 3 workspaces are already in
  "creating" status.
- **7 new tests** -- 4 in `@tdpl/db` (count queries), 3 in `@tdpl/server`
  (concurrency limits, cap recovery after pending workspaces finish).

#### Test Summary

| Package | Tests |
|---------|-------|
| `@tdpl/runtime` | 14 |
| `@tdpl/caddy` | 25 |
| `@tdpl/queue` | 5 |
| `@tdpl/db` | 29 |
| `@tdpl/server` | 28 |
| `@tdpl/worker` | 7 |
| **Total** | **108** |

---

### Workspace Redirect on srv0

Added a redirect route on srv0 (:8080) so that `/workspace/*` requests are redirected
to the same path on srv1. Previously, hitting `:8080/workspace/*` returned a blank 200
(no route matched). Now visitors are 302-redirected to the correct origin-isolated port.

#### Added

- **Workspace redirect route** — `buildBootstrapConfig({ srv1Port })` adds a
  `static_response` route to srv0 that 302-redirects `/workspace/*` to
  `{scheme}://{hostname}:{srv1Port}{uri}`. Uses Caddy placeholders to preserve the
  request scheme, hostname, and full URI.
- **`srv1Port` option** — `BootstrapOptions.srv1Port` controls the redirect target port.
  Server config reads from `SRV1_PORT` env var (default 8081).

### SDK Generation (WIP)

Added `@kattebak/openapi-generator-ts` to generate a TypeScript fetch client from
the OpenAPI spec. Build pipeline wired up (`make build-sdk`), but generated output
has compile errors tracked in kattebak/openapi-generator-ts#2. Not yet integrated
into the client — hand-written `api.ts` / `api-types.ts` remain the source of truth.

#### Added

- **`@kattebak/openapi-generator-ts` devDependency** — TypeScript port of OpenAPI
  Generator, generates fetch-based client SDK from OpenAPI YAML.
- **`npm-scripts/generate-sdk.sh`** — Generation script, patches output for ESM
  and workspace compatibility.
- **`make build-sdk` Makefile target** — Generates `@tdpl/sdk` in `build/sdk/`
  after TypeSpec compilation.
- **`@tdpl/sdk` workspace reference** — Registered in root `package.json` as
  `file:build/sdk`.

### Real VM Integration

Wire TartRuntime into the full dev stack so `RUNTIME=tart npm run dev:caddy` boots
real Tart VMs with code-server accessible through Caddy.

#### Added

- **Non-blocking `tart run`** — `TartRuntime.start()` now spawns `tart run` as a
  detached background process and polls `tart list` until the VM reaches "running"
  status. Previously, `start()` awaited the blocking `tart run` command, hanging the
  worker forever.
- **`RuntimeRepository.configure()` method** — Optional interface method for
  post-boot VM configuration. TartRuntime implementation uses SSH to write
  code-server's YAML config (`~/.config/code-server/config.yaml`) and restart via
  `systemctl restart code-server@admin`, ensuring `abs-proxy-base-path` matches
  `/workspace/{name}`. SSH is more reliable than `tart exec` because `sshd` starts
  before the Tart Guest Agent, critical for VM restarts.
- **SSH key pair** — `images/ssh/tidepool_ed25519` key pair for VM access. Public key
  baked into the `tidepool-workspace` base image's `authorized_keys`.
- **Code-server health check** — Worker polls `http://{vmIp}:8080/healthz` after VM
  boot and configuration, waiting for code-server to be ready before marking the
  workspace as "running". Injectable via `ProcessorDeps.healthCheck`.
- **srv1 basic auth** — `buildBootstrapConfig({ auth })` now adds an authentication
  handler to srv1 (port 8081) for `/workspace/*` paths. Previously workspace content
  was accessible without authentication.

#### Changed

- **Open IDE button** — URL now points to `http://{hostname}:8081/workspace/{name}/`
  (srv1) instead of same-origin `/workspace/{name}/` (srv0), matching ADR-015
  two-port origin isolation.
- **Default image** — Create workspace dialog uses `tidepool-workspace` (local Tart VM
  name from Packer build). Image renamed from `tidepool-alpine`.
- **Base image switched to Debian** — Base image changed from `ubuntu-runner-arm64` to
  `ghcr.io/cirruslabs/debian:latest`. Smaller (0.6GB compressed vs 20GB), faster to
  clone, and minimal. Setup script uses `apt-get`, `systemctl`, and writes YAML config
  at `~/.config/code-server/config.yaml`. The worker's `configure()` call overwrites
  the config per workspace at boot time.

#### Changed

- **`configure()` uses SSH instead of `tart exec`** — The Tart Guest Agent is
  unreliable on VM restart (connection refused for 30+ seconds). Switched to SSH
  with a dedicated key pair, which connects as soon as `sshd` starts (~2-3 seconds).
  Retry loop handles the brief window before SSH is ready.
- **`dev-caddy.sh` exports `SSH_KEY_PATH`** — Absolute path to the SSH key, since the
  server CWD is `packages/server/` but the key is at `images/ssh/tidepool_ed25519`.

#### Fixed

- **`tart exec` syntax** — Removed `--` separator before command arguments. Tart CLI
  uses `tart exec <name> <command> [args...]` without `--`.
- **Init system mismatch** — `configure()` was using Alpine/OpenRC commands
  (`/etc/conf.d/code-server`, `rc-service`) on an Ubuntu/systemd VM. Fixed to use
  `systemctl restart code-server@admin` and YAML config format.
- **SSH key in base image** — `tidepool-workspace` base image (Debian) has the SSH
  public key in `~/.ssh/authorized_keys`, baked in during Packer provisioning.

#### Test Summary

| Package | Tests |
|---------|-------|
| `@tdpl/runtime` | 14 |
| `@tdpl/caddy` | 22 |
| `@tdpl/queue` | 5 |
| `@tdpl/db` | 25 |
| `@tdpl/server` | 25 |
| `@tdpl/worker` | 7 |
| **Total** | **98** |

---

### End-to-End Localhost Integration

The full Tidepool stack now runs on localhost with a single command. Browser-verified:
create a workspace, watch it transition through the lifecycle, and manage it from the SPA.

**Two dev modes:**

```bash
npm run dev          # Stub mode: API + worker + client (ports 5173/7163)
npm run dev:caddy    # Full stack with Caddy (ports 8080/8081/7163)
```

### Added

- **Root dev script** (`npm run dev`) — starts API server, in-process worker, and client
  dev server concurrently. Signal cleanup on exit.
- **Full Caddy dev script** (`npm run dev:caddy`) — builds client SPA, starts Caddy,
  starts API server with Caddy bootstrap. Serves SPA at `http://localhost:8080/app/`.
- **Cursor-based pagination** on `GET /api/workspaces` — `limit`/`cursor` query params,
  `WorkspaceListResponse` TypeSpec model, base64url cursor encoding (`createdAt|id`),
  `ORDER BY createdAt DESC, id DESC`, `LIMIT n+1` strategy. Default 25, max 100.
- **Client infinite scroll** — `useInfiniteQuery` with "Load more" button when
  `hasNextPage` is true. API client passes `limit`/`cursor` params.
- **Basic auth in Caddy** — `hashPassword()` (bcrypt via bcryptjs),
  `buildBootstrapConfig({ auth })` adds authentication handlers to srv0. Protects
  `/api/*` and `/app/*`, health check (`/api/health`) bypasses auth. Configured via
  `CADDY_USERNAME`/`CADDY_PASSWORD` env vars on server startup.
- **Caddy bootstrap config** — `buildBootstrapConfig()` now generates complete srv0
  routes: API reverse proxy, SPA file server with path stripping, root redirect
  (`/` -> `/app/workspaces`). Server bootstraps Caddy automatically on startup when
  not in stub mode.
- **Dev mode stubs** — `createStubRuntime()` (in-memory VM simulation with
  auto-incrementing IPs) and `createStubCaddy()` (no-op). Enables full lifecycle
  testing without real VMs or Caddy.
- **In-process worker** — Server embeds worker poll loop when `NODE_ENV=test` or
  `WORKER_INLINE=true`, sharing the same MemoryQueue instance. Eliminates the
  separate-process problem where jobs were invisible across queue instances.
- **Worker idle delay** — Poll loop sleeps 500ms (configurable) when queue is empty
  instead of busy-spinning.
- **Worker production entrypoint** — `packages/worker/src/main.ts` wires SQS, Tart
  runtime, Caddy client, and starts the poll loop for production deployment.
- **Caddy Origin header** — CaddyClient sends `Origin` header on all admin API
  requests (required by Caddy v2.11+).

### Changed

- **`@tdpl/caddy`** — 7 -> 21 tests. Added auth, bootstrap config, API proxy, SPA
  serving, and root redirect functionality.
- **`@tdpl/db`** — 17 -> 25 tests. Added cursor encoding/decoding and pagination
  query logic.
- **`@tdpl/server`** — 21 -> 25 tests. Paginated list endpoint, decoupled startup
  into independent concerns (stubs, inline worker, Caddy bootstrap).
- **`@tdpl/server` config** — Added `caddyUsername`, `caddyPassword`, `spaRoot` config
  fields from env vars.
- **`@tdpl/client` API layer** — `listWorkspaces()` accepts `limit`/`cursor` params,
  returns `PaginatedResponse<Workspace>`.
- **`@tdpl/client` hooks** — `useWorkspaces()` switched from `useQuery` to
  `useInfiniteQuery` with cursor pagination.
- **TypeSpec** — `Workspaces.list` now accepts `@query limit?: int32` and
  `@query cursor?: string`, returns `WorkspaceListResponse` model.

### Documentation

- **EDD-006** — Updated package test counts (93 total), refreshed "What Comes Next"
  table, added "Lessons Learned" section covering: in-process worker for dev mode,
  stub implementations, TypeSpec cascade effects, Caddy v2.11 Origin header, bootstrap
  config composability, client/server response shape alignment.
- **EDD-007** — Added pagination implementation status note.
- **EDD-003** — Updated basic auth decision with implementation details.
- **EDD-008** — Added dev mode stubs and in-process worker to decisions table.

### Test Summary

| Package | Tests |
|---------|-------|
| `@tdpl/runtime` | 10 |
| `@tdpl/caddy` | 21 |
| `@tdpl/queue` | 5 |
| `@tdpl/db` | 25 |
| `@tdpl/server` | 25 |
| `@tdpl/worker` | 7 |
| **Total** | **93** |
