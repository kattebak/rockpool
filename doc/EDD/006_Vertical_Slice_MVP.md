# EDD: Vertical Slice MVP

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Draft      |
| Created | 2026-02-21 |
| Updated | 2026-02-22 |

## Summary

Minimal end-to-end proof of the Tidepool concept on macOS: a browser request hits Caddy, gets routed by path to a Tart VM running code-server, and the user lands in a working IDE. Three components, no control plane services, no async workers -- just the critical path. A local fast path uses a public Ubuntu runner image while the Alpine Packer path is blocked by registry access.

## Prerequisites

- [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md) -- Tart selected for macOS
- [EDD 003: Caddy Reverse Proxy](003_Caddy_Reverse_Proxy.md) -- path-based routing, admin API
- [EDD 004: Web IDE](004_Web_IDE.md) -- code-server selected
- [EDD 005: Workspace Image Pipeline](005_Workspace_Image_Pipeline.md) -- Alpine, Packer, local builds
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
│  Caddy   │────▶│  Tart VM (Alpine)     │
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

- Packer template for Alpine + code-server Tart image
- Shared provisioning script (`alpine-setup.sh`)
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
  alpine-workspace.pkr.hcl    -- Packer template
  scripts/
    alpine-setup.sh            -- shared provisioning script
```

### Provisioning Script (`alpine-setup.sh`)

Installs everything on a vanilla Alpine base:

1. Update apk, install base packages: bash, curl, wget, jq, git, openssh, make
2. Install Node.js (via apk or nvm)
3. Install Python 3
4. Install code-server (standalone release from GitHub)
5. Configure code-server:
   - Bind to `0.0.0.0:8080`
   - Disable built-in auth (`--auth none`, auth lives in Caddy)
   - Set `--abs-proxy-base-path /workspace/test` (hardcoded for MVP; production uses env var)
   - Disable telemetry
6. Create an OpenRC service for code-server (Alpine uses OpenRC, not systemd)
7. Create a default workspace user (non-root)

### Build Command

```bash
npm run build:image
```

Output: a Tart VM image named `tidepool-alpine` available via `tart list`.

### Local Fast Path (Ubuntu Runner)

If the Alpine base image is not accessible, use the public Ubuntu runner image and configure code-server in-place. This is the current working path on macOS.

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

- Packer template and Alpine provisioning script for a future baked image
- Local fast path using public Tart Ubuntu runner image to avoid registry auth
- Helper scripts to bootstrap Caddy, start VM, and configure code-server
- Makefile and npm scripts wired for MVP tasks

### Relevant Files

- `images/alpine-workspace.pkr.hcl`
- `images/scripts/alpine-setup.sh`
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

- [ ] Packer builds the Alpine image without errors
- [ ] Tart VM boots and code-server is accessible on :8080
- [ ] Caddy routes `/workspace/test/*` to the VM
- [ ] code-server loads in the browser at the subpath
- [ ] Terminal works (WebSocket pass-through)
- [ ] File editing works
- [ ] code-server extensions panel loads
- [ ] Can `git clone` a repo inside the workspace (internet egress works)

## Risks and Unknowns

| Risk                                                  | Impact  | Mitigation                                                                                                                            |
| ----------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Alpine + musl breaks code-server                      | Blocker | code-server ships standalone musl-compatible builds; fall back to Debian if needed                                                    |
| Tart registry access returns 403 for Alpine base      | High    | Use public Ubuntu runner image until a public Alpine base is available                                                                |
| Tart Packer builder issues                            | Low     | [cirruslabs/packer-plugin-tart](https://github.com/cirruslabs/packer-plugin-tart) v1.19.0, actively maintained, on HashiCorp registry |
| code-server subfolder mounting breaks with WebSockets | High    | `--abs-proxy-base-path` is designed for this; test early                                                                              |
| Caddy and Tart compete for port 8080                  | Low     | Different networks -- Caddy on host :8080, code-server on VM :8080                                                                    |

## What Was Implemented: Control Plane Packages

All control plane packages have been built on top of this vertical slice. See [EDD 008](008_Package_Structure.md) for the package structure.

### Packages (all under `@tdpl/*` scope)

| Package | Status | Tests | Description |
|---------|--------|-------|-------------|
| `@tdpl/runtime` | Done | 10 | TartRuntime adapter wrapping `tart` CLI (create, start, stop, remove, status, getIp with polling). Injectable exec for testing. |
| `@tdpl/caddy` | Done | 7 | Caddy admin API client via native fetch. Two-port routing: workspace + port routes go to srv1 (:8081), bootstrap creates both srv0 and srv1. |
| `@tdpl/queue` | Done | 5 | SQS-compatible queue client + in-memory implementation for dev/testing. |
| `@tdpl/db` | Done | 17 | SQLite + Drizzle ORM. Hand-written schema (generated Drizzle emitter targets Postgres, not usable). Workspace + Port tables with cascade delete. |
| `@tdpl/server` | Done | 21 | Express control plane with express-openapi-validator. Workspace CRUD + lifecycle + port forwarding endpoints. State machine enforcement. |
| `@tdpl/worker` | Done | 7 | Async job processor: create/start/stop/delete lifecycle. Cleans up port routes on stop/delete. |

**Total: 67 tests, all passing.**

### Key Integration Points

- **OpenAPI validation**: express-openapi-validator wired against the generated OpenAPI spec. Request bodies validated automatically (name pattern, required fields, port range).
- **Two-port origin isolation (ADR-015)**: Caddy bootstrap creates srv0 (:8080) for API/SPA and srv1 (:8081) for workspace content. Workspace and port routes go to srv1.
- **Port forwarding**: Full vertical — TypeSpec model, DB table, API endpoints (GET/POST/DELETE), Caddy route management, worker cleanup on stop/delete. Max 5 ports per workspace, range 1024-65535.
- **State machine**: Service layer enforces valid transitions. Ports can only be registered on running workspaces.

### Lifecycle Flow (End-to-End)

1. `POST /api/workspaces {name, image}` → validates, inserts DB (status: creating), enqueues create job
2. Worker picks up job → `tart clone` + `tart run` + poll for IP → `caddy.addWorkspaceRoute` to srv1 → DB status: running
3. `POST /api/workspaces/:id/ports {port, label?}` → validates running, inserts DB, `caddy.addPortRoute` to srv1
4. `POST /api/workspaces/:id/stop` → validates state, DB status: stopping, enqueues stop job
5. Worker picks up job → removes all port routes + records → `tart stop` → `caddy.removeWorkspaceRoute` → DB status: stopped
6. `DELETE /api/workspaces/:id` → validates stopped/error, enqueues delete job
7. Worker picks up job → removes port routes → stops VM → removes VM → removes workspace route → deletes from DB

## What Comes Next

| Item | Status | Notes |
|------|--------|-------|
| `@tdpl/client` (React SPA) | Done | React + shadcn/ui + TanStack Query/Router at `/app/*`. See below. |
| esbuild bundling | Done | ADR-011. Client builds via esbuild (503kb JS, 39kb CSS, ~300ms). Makefile target `build-client`. |
| Root dev/test scripts | TODO | `npm run dev` (API + client), `npm test` (aggregate all packages) |
| One-line installer & CLI | RFC | See [RFC-001](../RFC/001_One_Line_Installer_and_CLI.md) |
| Pagination (cursor-based) | TODO | EDD-007 specifies limit + cursor |
| Rate limiting (Caddy) | TODO | EDD-003 specifies Caddy-level rate limiting |
| IncusRuntime adapter | TODO | Linux support via Incus REST API |
| Alpine image access | TODO | Tart registry 403 for Alpine base, using Ubuntu runner |
| Auth (basic auth in Caddy) | TODO | Single-user basic auth |
| Network isolation | TODO | Bridge network, firewall rules, NAT egress |

## What Was Implemented: React SPA (`@tdpl/client`)

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
