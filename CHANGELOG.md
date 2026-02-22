# Changelog

All notable changes to the Tidepool project are documented here.

## [Unreleased]

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
