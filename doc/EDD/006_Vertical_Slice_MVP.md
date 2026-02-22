# EDD: Vertical Slice MVP

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Draft      |
| Created | 2026-02-21 |
| Updated | 2026-02-22 |

## Summary

Minimal end-to-end proof of the Rockpool concept on macOS: a browser request hits Caddy, gets routed by path to a Tart VM running code-server, and the user lands in a working IDE. Three components, no control plane services, no async workers -- just the critical path. A local fast path can use a public Ubuntu runner image to avoid registry auth, while the Debian Packer path remains the intended base.

## Prerequisites

- [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md) -- Tart selected for macOS
- [EDD 003: Caddy Reverse Proxy](003_Caddy_Reverse_Proxy.md) -- path-based routing, admin API
- [EDD 004: Web IDE](004_Web_IDE.md) -- code-server selected
- [EDD 005: Workspace Image Pipeline](005_Workspace_Image_Pipeline.md) -- Debian, Packer, local builds
- [EDD 007: Data Model](007_Data_Model.md) -- workspace entity, status model, API surface
- [EDD 008: Package Structure](008_Package_Structure.md) -- monorepo layout, repository pattern

## Goal

Open `http://localhost:8080/workspace/test/` in a browser and land in a fully functional code-server IDE running inside an isolated Tart VM.

```
Browser
  │
  │  GET /workspace/test/
  │
  ▼
┌──────────┐     ┌───────────────────────┐
│  Caddy   │────▶│  Tart VM (Debian)     │
│  :8080   │     │  code-server :8080    │
│          │     │  git, bash, node, etc │
└──────────┘     └───────────────────────┘
```

## MVP vs Production Differences

This slice intentionally simplifies the production architecture (see [EDD 001](001_Architecture_Overview.md)):

| Aspect                | MVP (this EDD)                                | Production                                                  |
| --------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| Caddy location        | Host macOS (`brew install`)                   | Root VM (co-located with control plane)                     |
| Auth                  | None                                          | Basic auth in Caddy, upgradable to `forward_auth`           |
| Route structure       | Flat route per workspace                      | Subroute with port forwarding (8081-8085)                   |
| URL scheme            | `/workspace/test/*` only                      | `/api/*`, `/app/*`, `/workspace/{name}/*`                   |
| code-server base path | Baked into OpenRC service (`/workspace/test`) | Set via env var at VM boot (`/workspace/${WORKSPACE_NAME}`) |

## Scope

### In scope

- Packer template for Debian + code-server Tart image
- Shared provisioning script (`alpine-setup.sh`, legacy name)
- Local fast path using a public Tart Ubuntu runner image to avoid registry auth
- Scripted VM start and setup via npm scripts
- Scripted Caddy bootstrap and route management via npm scripts
- WebSocket pass-through (terminal, LSP)
- code-server `--abs-proxy-base-path /workspace/test` for subfolder mounting

### Out of scope

- Control plane services (Workspace Service, Caddy Service, Worker)
- ElasticMQ / async job processing
- Programmatic VM lifecycle (Tart adapter)
- Multiple workspaces
- Incus / Linux support
- Network isolation (NAT-only, firewall rules)
- Auth, TLS, Cloudflare Tunnel
- Port forwarding routes (8081-8085, see [EDD 003](003_Caddy_Reverse_Proxy.md))

## Component 1: Workspace Image

### Packer Template

Packer HCL template using the Tart builder to produce an OCI-compatible VM image.

**Local-only fast path (no Packer):** If you just need the MVP working quickly on macOS, you can use a public Tart base image (Ubuntu runner) and install code-server in-place. This avoids registry auth and Packer setup. It still uses Tart + Caddy and matches the routing behavior; the only deviation is the base distro.

```
images/
  alpine-workspace.pkr.hcl    -- Packer template (legacy name, Debian base)
  scripts/
    alpine-setup.sh            -- shared provisioning script (legacy name)
```

### Provisioning Script (`alpine-setup.sh`, legacy name)

Installs everything on a vanilla Debian base:

1. Update apt, install base packages: bash, curl, wget, jq, git, openssh, make
2. Install Node.js (via apk or nvm)
3. Install Python 3
4. Install code-server (standalone release from GitHub)
5. Configure code-server:
   - Bind to `0.0.0.0:8080`
   - Disable built-in auth (`--auth none`, auth lives in Caddy)
   - Set `--abs-proxy-base-path /workspace/test` (hardcoded for MVP; production uses env var)
   - Disable telemetry
6. Create a systemd service for code-server
7. Create a default workspace user (non-root)

### Build Command

```bash
npm run build:image
```

Output: a Tart VM image named `rockpool-workspace` available via `tart list`.

### Base Image

Uses `ghcr.io/cirruslabs/debian:latest` as the base (Debian minimal, 0.6GB compressed). The Cirrus Labs Alpine image returns 403; Ubuntu runner works but is 20GB+ and bloated. Debian is the best balance of size, compatibility, and systemd support.

## Component 2: Tart VM

### Start the VM

```bash
npm run mvp:start-vm
```

### Get the VM IP

The start script prints the VM IP (for example, `192.168.64.5`). Keep it for the route step.

### Verify code-server

```bash
npm run mvp:setup-vm
```

This script installs and configures code-server and starts the service inside the VM.

## Component 3: Caddy Route

### Install and Run Caddy

For the MVP, Caddy runs on the host (not in the root VM). Production moves it inside the root VM alongside the control plane (see [EDD 003](003_Caddy_Reverse_Proxy.md)).

```bash
brew install caddy
caddy start
```

### Bootstrap Config

```bash
npm run mvp:caddy:bootstrap
```

### Add Workspace Route

```bash
npm run mvp:caddy:add-route -- -n test -i <VM_IP>
```

### Verify

```bash
npm run mvp:verify
```

Open `http://localhost:8080/workspace/test/` in a browser. code-server IDE should load with working terminal and file editor.

## How to Run (Scripts)

1. Start a VM (prints VM IP): `npm run mvp:start-vm`
2. Configure code-server in the VM: `npm run mvp:setup-vm`
3. Start Caddy and load config:

- `caddy start`
- `npm run mvp:caddy:bootstrap`

4. Add a route: `npm run mvp:caddy:add-route -- -n test -i <VM_IP>`
5. Verify: `npm run mvp:verify`
6. Open `http://localhost:8080/workspace/test/`

## What Was Implemented (Record)

- Packer template and Debian provisioning script for a future baked image
- Local fast path using public Tart Ubuntu runner image to avoid registry auth
- Helper scripts to bootstrap Caddy, start VM, and configure code-server
- Makefile and npm scripts wired for MVP tasks

### Real VM Integration (Tart)

- `runtime.configure()` writes code-server YAML config and restarts via `systemctl` inside the VM
- Worker calls `configure()` + health check (polls `/healthz`) after VM boot, before adding Caddy route
- Full end-to-end lifecycle verified with real Tart VMs: create → clone → boot → configure → health check → Caddy route → running
- code-server IDE accessible at `http://localhost:8081/workspace/{name}/` (srv1, two-port isolation)
- VM boots in ~7s total (clone + start + configure + health check)

### Relevant Files

- `images/alpine-workspace.pkr.hcl` (legacy name, Debian base)
- `images/scripts/alpine-setup.sh` (legacy name)
- `npm-scripts/mvp-build-image.sh`
- `npm-scripts/mvp-start-vm.sh`
- `npm-scripts/mvp-setup-vm.sh`
- `npm-scripts/mvp-verify.sh`
- `npm-scripts/caddy-bootstrap.sh`
- `npm-scripts/caddy-add-workspace-route.sh`
- `npm-scripts/caddy-remove-workspace-route.sh`
- `Makefile`
- `package.json`
- `README.md`

## Validation Checklist

- [ ] Packer builds the Debian image without errors
- [ ] Tart VM boots and code-server is accessible on :8080
- [ ] Caddy routes `/workspace/test/*` to the VM
- [ ] code-server loads in the browser at the subpath
- [ ] Terminal works (WebSocket pass-through)
- [ ] File editing works
- [ ] code-server extensions panel loads
- [ ] Can `git clone` a repo inside the workspace (internet egress works)

## Risks and Unknowns

| Risk                                                  | Impact | Mitigation                                                                                                                            |
| ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Base image registry access fails                      | High   | Use public Ubuntu runner image until registry access is available                                                                     |
| Tart Packer builder issues                            | Low    | [cirruslabs/packer-plugin-tart](https://github.com/cirruslabs/packer-plugin-tart) v1.19.0, actively maintained, on HashiCorp registry |
| code-server subfolder mounting breaks with WebSockets | High   | `--abs-proxy-base-path` is designed for this; test early                                                                              |
| Caddy and Tart compete for port 8080                  | Low    | Different networks -- Caddy on host :8080, code-server on VM :8080                                                                    |

## What Was Implemented: Control Plane Packages

All control plane packages have been built on top of this vertical slice. See [EDD 008](008_Package_Structure.md) for the package structure.

### Packages (all under `@rockpool/*` scope)

| Package         | Status | Tests | Description                                                                                                                                                                                                                                                             |
| --------------- | ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@rockpool/runtime` | Done   | 12    | TartRuntime adapter wrapping `tart` CLI (create, start, stop, remove, status, getIp with polling, configure). `configure()` writes code-server YAML config and restarts via systemctl. Injectable exec for testing. StubRuntime for dev mode (in-memory VM simulation). |
| `@rockpool/caddy`   | Done   | 21    | Caddy admin API client via native fetch. Two-port routing: workspace + port routes go to srv1 (:8081). Full bootstrap config with auth, API proxy, SPA serving, root redirect. StubCaddy for dev mode.                                                                  |
| `@rockpool/queue`   | Done   | 5     | SQS-compatible queue client + in-memory implementation for dev/testing.                                                                                                                                                                                                 |
| `@rockpool/db`      | Done   | 25    | SQLite + Drizzle ORM. Hand-written schema (generated Drizzle emitter targets Postgres, not usable). Workspace + Port tables with cascade delete. Cursor-based pagination on workspace listing.                                                                          |
| `@rockpool/server`  | Done   | 25    | Express control plane with express-openapi-validator. Workspace CRUD + lifecycle + port forwarding endpoints. State machine enforcement. Paginated list endpoint (limit/cursor). In-process worker for dev mode.                                                        |
| `@rockpool/worker`  | Done   | 7     | Async job processor: create/start/stop/delete lifecycle. Calls `runtime.configure()` + health check after VM boot. Cleans up port routes on stop/delete. Poll loop with configurable idle delay. Standalone production entrypoint.                                      |

**Total: 96 tests, all passing.**

### Key Integration Points

- **OpenAPI validation**: express-openapi-validator wired against the generated OpenAPI spec. Request bodies validated automatically (name pattern, required fields, port range).
- **Two-port origin isolation (ADR-015)**: Caddy bootstrap creates srv0 (:8080) for API/SPA and srv1 (:8081) for workspace content. Workspace and port routes go to srv1.
- **Port forwarding**: Full vertical — TypeSpec model, DB table, API endpoints (GET/POST/DELETE), Caddy route management, worker cleanup on stop/delete. Max 5 ports per workspace, range 1024-65535.
- **State machine**: Service layer enforces valid transitions. Ports can only be registered on running workspaces.

### Lifecycle Flow (End-to-End)

1. `POST /api/workspaces {name, image}` → validates, inserts DB (status: creating), enqueues create job
2. Worker picks up job → `tart clone` + `tart run` + poll for IP → `runtime.configure()` (writes code-server config, restarts service) → health check (poll code-server `/healthz` up to 60s) → `caddy.addWorkspaceRoute` to srv1 → DB status: running
3. `POST /api/workspaces/:id/ports {port, label?}` → validates running, inserts DB, `caddy.addPortRoute` to srv1
4. `POST /api/workspaces/:id/stop` → validates state, DB status: stopping, enqueues stop job
5. Worker picks up job → removes all port routes + records → `tart stop` → `caddy.removeWorkspaceRoute` → DB status: stopped
6. `DELETE /api/workspaces/:id` → validates stopped/error, enqueues delete job
7. Worker picks up job → removes port routes → stops VM → removes VM → removes workspace route → deletes from DB

## What Comes Next

| Item                         | Status | Notes                                                                                                                                                                                                                                  |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@rockpool/client` (React SPA)   | Done   | React + shadcn/ui + TanStack Query/Router at `/app/*`. See below.                                                                                                                                                                      |
| esbuild bundling             | Done   | ADR-011. Client builds via esbuild (503kb JS, 39kb CSS, ~300ms). Makefile target `build-client`.                                                                                                                                       |
| Root dev/test scripts        | Done   | `npm run dev` starts API server + worker (in-process) + client dev server concurrently. `npm test` aggregates all packages.                                                                                                            |
| Pagination (cursor-based)    | Done   | TypeSpec → OpenAPI → DB → service → routes. `limit`/`cursor` query params, `WorkspaceListResponse` model, base64url cursor encoding.                                                                                                   |
| Auth (basic auth in Caddy)   | Done   | `hashPassword()` (bcrypt) + `buildBootstrapConfig({ auth })`. Protects `/api/*` and `/app/*` on srv0 and `/workspace/*` on srv1, health check bypasses auth. Wired into server startup via `CADDY_USERNAME`/`CADDY_PASSWORD` env vars. |
| Dev mode stubs               | Done   | `StubRuntime` (in-memory VM sim) and `StubCaddy` (no-op) for local dev without real VMs or Caddy. Server embeds worker in-process when `NODE_ENV=test`.                                                                                |
| Client pagination            | Done   | `useInfiniteQuery` with cursor-based pagination. "Load more" button when `hasNextPage` is true.                                                                                                                                        |
| End-to-end Caddy integration | Done   | Server bootstraps Caddy on startup (when not in stub mode). `buildBootstrapConfig` generates srv0 routes: API proxy, SPA file server, root redirect. `npm run dev:caddy` runs full stack. Browser-verified via Chrome DevTools.        |
| Rate limiting (Caddy)        | TODO   | EDD-003 specifies Caddy-level rate limiting                                                                                                                                                                                            |
| IncusRuntime adapter         | TODO   | Linux support via Incus REST API                                                                                                                                                                                                       |
| Base image access            | TODO   | Use Ubuntu runner image if registry access fails                                                                                                                                                                                       |
| Network isolation            | TODO   | Bridge network, firewall rules, NAT egress                                                                                                                                                                                             |

## Lessons Learned

### In-process worker is essential for dev mode

The original design (EDD-008) assumed server and worker always run as separate processes. In practice, separate processes with `MemoryQueue` don't share state — each gets its own queue instance, so jobs enqueued by the server are invisible to the worker. The fix was embedding the worker poll loop inside the server process for dev mode, sharing the same `MemoryQueue` instance. Production still uses separate processes with SQS. This is controlled by `WORKER_INLINE=true` or `NODE_ENV=test`.

### Stub implementations unblock the full stack

Real VMs (Tart) and real Caddy aren't always available during development. `StubRuntime` simulates VM lifecycle in-memory (with auto-incrementing IPs), and `StubCaddy` is a no-op. This lets the full lifecycle work end-to-end without any external dependencies. The `RUNTIME=tart` env var opt-in keeps real VM testing available.

### TypeSpec changes cascade through the whole stack

Changing the `list` operation from `Workspace[]` to `WorkspaceListResponse` (for pagination) required updates to: TypeSpec → OpenAPI spec → Zod validators → DB queries → service layer → route handlers → client API types → client hooks → client components. The TypeSpec-first approach (ADR-003) ensures the spec stays authoritative, but the blast radius of model changes is large. Keep the TypeSpec model stable once consumers exist.

### Caddy v2.11+ requires Origin header

Caddy's admin API added a security check requiring an `Origin` header on all requests. The CaddyClient needed to send `Origin: http://localhost` (or whatever the admin URL is) with every request. This wasn't documented in older Caddy docs and caused silent failures.

### Bootstrap config is more than just routes

The initial `buildBootstrapConfig` only handled auth. The full localhost setup needed API proxy routes (`/api/*` → control plane), SPA file serving (`/app/*` → built assets), and a root redirect (`/` → `/app/workspaces`). Building these incrementally as options (`controlPlaneUrl`, `spaRoot`, `auth`) kept the function composable.

### Client response shape must match server

When the server changed from returning `Workspace[]` to `{ items, nextCursor }`, the client broke silently (TanStack Query returned undefined). The fix was straightforward (`select: response => response.items` initially, then `useInfiniteQuery` for proper pagination), but highlights the need for client-side type safety against the API contract.

### Base image: Debian, not Alpine or Ubuntu

The `rockpool-workspace` VM image uses `ghcr.io/cirruslabs/debian:latest` as base. The Cirrus Labs Alpine image is blocked by registry 403; Ubuntu runner works but is bloated (20GB+). Debian is minimal (0.6GB compressed), uses systemd with a `code-server@admin` template service unit and YAML config at `~/.config/code-server/config.yaml`.

### SSH for VM configuration, not `tart exec`

The Tart Guest Agent doesn't work reliably on Linux VMs — `tart exec` fails with "Failed to connect to the VM using its control socket" even when the agent service is running. Switched `configure()` to use SSH with a pre-shared ed25519 key pair (`images/ssh/rockpool_ed25519`). SSH connects as soon as `sshd` starts (~2-3s), much faster than the guest agent on restart.

## What Was Implemented: React SPA (`@rockpool/client`)

The full React SPA has been implemented at `packages/client/`. Browser-verified end-to-end.

### Tech Stack

- **React** with **TanStack Router** (basepath `/app`) and **TanStack Query** (data fetching)
- **shadcn/ui** components (13 components copied in: button, table, badge, dialog, input, select, dropdown-menu, skeleton, alert, tooltip, separator, card, sonner)
- **Tailwind CSS v4** with design tokens from EDD-009
- **esbuild** for production bundling + dev server with API proxy
- **lucide-react** for icons

### Routes

- `/app/workspaces` — Workspace list (table, search/filter, empty state, skeleton loading)
- `/app/workspaces/:id` — Workspace detail (header, status badge, actions, details panel, ports panel)
- `/app/settings` — Placeholder

### Features

- **Workspace list**: Table with columns (Name, Status, Image, Updated, Actions). Search/filter by name or image. Status badges with colors (Creating, Running, Stopping, Stopped, Error). Row-level actions via dropdown menu.
- **Create workspace modal**: Name field with validation (3-63 chars, lowercase alphanumeric + hyphens). Image field (read-only default). Cancel/Create buttons.
- **Workspace detail**: Breadcrumb navigation. Header with name, status badge, action buttons (Open IDE, Stop, Delete). Details card (image, created date, relative timestamp). Ports panel with add/remove and links to workspace port routes.
- **Confirmation dialogs**: Stop and delete workspace with warning messages.
- **Error states**: Alert with retry button when API is unreachable.
- **Loading states**: Skeleton UI while data is fetching.

### API Integration

All 9 API operations wired via TanStack Query with auto-refetch and cache invalidation:

- List workspaces (5s refetch), Get workspace (3s refetch)
- Create, Delete, Start, Stop workspace
- List ports, Add port, Remove port

### Build & Dev

- **Production build**: `npm run build -w packages/client` → `build/client/` (assets/main.js + main.css)
- **Dev server**: `npm run dev -w packages/client` → port 5173 with API proxy to port 7163
- **Makefile target**: `make build-client` (depends on `build-typespec`)

### Design System (from EDD-009)

- Colors: Background #F7F8FA, Surface #FFFFFF, Accent #137CBD, Success #0F9960, Warning #D9822B, Danger #C23030
- Fonts: Source Sans 3 (body), IBM Plex Mono (code)
- Max content width: 1200px, 8px spacing scale
- Light theme only

### Relevant Files

- `packages/client/package.json`
- `packages/client/src/main.tsx` — App entry point
- `packages/client/src/router.tsx` — TanStack Router with basepath `/app`
- `packages/client/src/routes/` — Page components
- `packages/client/src/hooks/` — TanStack Query hooks
- `packages/client/src/lib/api.ts` — Typed fetch client
- `packages/client/src/components/` — UI components
- `packages/client/src/build.ts` — esbuild production build
- `packages/client/src/dev-server.ts` — Dev server with API proxy
