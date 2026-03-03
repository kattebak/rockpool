# EDD: Rockpool Architecture Overview

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Accepted   |
| Created | 2026-02-21 |
| Updated | 2026-03-03 |

## Summary

Rockpool is a lightweight cloud IDE platform inspired by Cloud9. It provides isolated development environments running in Podman containers, accessible through a web browser via a unified reverse proxy. The system runs on a single host (laptop or office server) with external ingress via a reverse proxy service like Cloudflare Tunnel.

## Baseline Decisions (First Plan Anchors)

These are the explicit starting decisions for production planning beyond the MVP. Everything else in the plan assumes these unless revised.

- **Auth:** Single-user basic auth only (no external IdP, no multi-user login UI).
- **Auth upgrade path:** Ory/JWT is the likely next step, but out of scope for now.
- **Data retention:** Workspace data persists in Podman named volumes on stop; delete is irreversible.
- **Lifecycle controls:** Manual start/stop only; no idle auto-stop or schedules.
- **Operations baseline:** Minimal local JSON logs only; no metrics, alerts, or centralized logging. Logs aggregated via `podman compose logs`.
- **Image distribution:** Local builds only, no shared registry or distribution pipeline.
- **Routing scheme:** Path-based routing only; no subdomains.
- **Backups:** No backups or snapshot exports.
- **Queue semantics:** Use DB-backed locks to prevent duplicate lifecycle operations.
- **Workspace naming:** Unique per user; start with a single default user configuration.
- **Resource exhaustion:** Reject new starts and guide the user to stop the least recently accessed workspace.
- **Schema migrations:** Not a concern for now; revisit when multi-user or upgrades require it.
- **Port registration behavior:** Allow registration even if the service is not listening; proxy returns 502 until the port is live.
- **Audit trail:** Minimal activity log only.
- **Workspace templates:** Start with a single default image template.
- **Timestamps:** Store in UTC in the backend; UI handles localization and accessibility.

## System Topology

### Linux (direct on host)

On Linux, there is no Root VM layer. The control plane runs as containers via `podman compose` directly on the host. Workspace containers are created as siblings managed by the host's Podman.

```
┌──────────────────────────────────────────────┐
│  Host (Linux)                                │
│                                              │
│  podman compose up                           │
│  ┌────────────────────────────────────────┐  │
│  │ compose stack (bridge network)         │  │
│  │                                        │  │
│  │  ┌───────┐ ┌──────┐ ┌──────┐         │  │
│  │  │ caddy │ │server│ │worker│         │  │
│  │  │ :8080 │ │:7163 │ │      │         │  │
│  │  │ :8081 │ │      │ │      │         │  │
│  │  │ :8082 │ │      │ │      │         │  │
│  │  └───────┘ └──────┘ └──────┘         │  │
│  │  ┌─────────┐ ┌──────┐                │  │
│  │  │elasticmq│ │client│                │  │
│  │  │ :9324   │ │:5173 │                │  │
│  │  └─────────┘ └──────┘                │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────┐ ┌────────┐  workspace containers │
│  │ ws-a   │ │ ws-b   │  (created via socket) │
│  │ :44231 │ │ :44232 │                       │
│  └────────┘ └────────┘                       │
└──────────────────────────────────────────────┘
```

### macOS (Root VM)

On macOS, a Root VM (Tart or QEMU) provides a Linux environment. The control plane compose stack runs inside the VM with the project directory mounted via Virtiofs. See [EDD-022](022_Root_VM.md) for details.

```
┌──────────────────────────────────────┐
│         Host (macOS)                 │
│                                      │
│  Tart / QEMU (hypervisor only)      │
│  User's editor                       │
│                                      │
│  ┌────────────────────────────────┐  │
│  │      Root VM (Linux)          │  │
│  │                                │  │
│  │  podman compose               │  │
│  │  (caddy, server, worker,     │  │
│  │   elasticmq, client)         │  │
│  │                                │  │
│  │  ┌────────┐ ┌────────┐       │  │
│  │  │ ws-a   │ │ ws-b   │       │  │
│  │  │(podman)│ │(podman)│       │  │
│  │  └────────┘ └────────┘       │  │
│  │                                │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

Ports `:8080`, `:8081`, and `:8082` are separate browser origins, providing origin isolation between the control plane, IDE sessions, and app previews. See [ADR-015](../ADR/015-three-port-origin-isolation.md).

## Components

### 1. Control Plane (Podman Compose)

The control plane runs as five containers orchestrated by `podman compose`. All control plane containers share a bridge network (via `network_mode: "service:caddy"`) so they can communicate over localhost. The compose stack is defined in `compose.yaml` with environment-specific overrides via `.env` files.

See: [EDD-025: Compose Control Plane](025_Compose_Control_Plane.md)

#### Caddy (Reverse Proxy)

Entry point for all HTTP traffic, split across three ports for origin isolation. Bootstrapped programmatically via its admin API (`:2019`) by the server on startup.

Responsibilities:

- Origin isolation between control plane (`:8080`), IDE sessions (`:8081`), and app previews (`:8082`)
- Route requests to the correct workspace container based on URL path
- Strip path prefixes before forwarding
- Handle WebSocket upgrades (automatic in Caddy)
- Basic auth (upgradable to `forward_auth` later)
- TLS termination (when not behind Cloudflare)

See: [EDD 003: Caddy Reverse Proxy](003_Caddy_Reverse_Proxy.md)

#### Services

The API server lives in `@rockpool/server` and the async worker in `@rockpool/worker` -- both compose integration packages (`@rockpool/runtime`, `@rockpool/caddy`, `@rockpool/queue`, `@rockpool/db`) via dependency injection. See [EDD 008: Package Structure](008_Package_Structure.md) for the full layout.

```
┌──────────────────────────────────────────────────────────┐
│            Compose Stack (bridge network)                │
│                                                          │
│  ┌──────────┐                                            │
│  │  Caddy   │ :8080 (API+SPA), :8081 (IDE), :8082 (app) │
│  └────┬─────┘ :2019 (admin, localhost only)              │
│       │ localhost                                        │
│  ┌────┴─────────────┐  ┌─────────────────┐              │
│  │ Server           │  │ Caddy Service   │              │
│  │ (CRUD, status)   │  │ (route config)  │              │
│  └────────┬─────────┘  └────────┬────────┘              │
│           │                     │                        │
│  ┌────────┴─────────────────────┴────────┐              │
│  │         Worker                        │              │
│  │   (async lifecycle via ElasticMQ)     │              │
│  └───────────────────────────────────────┘              │
│                                                          │
│  ┌───────────────────────────────────────┐              │
│  │  ElasticMQ (async job queue)          │              │
│  │  (softwaremill/elasticmq-native)     │              │
│  └───────────────────────────────────────┘              │
│                                                          │
│  ┌───────────────────────────────────────┐              │
│  │  Client (Vite dev server, :5173)      │              │
│  └───────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────┘
```

- **Server** -- workspace CRUD and status, serves SPA at `/app/*` and API at `/api/*`. Workspace entity and status model defined in [EDD 007: Data Model](007_Data_Model.md).
- **Caddy Service** -- configures Caddy routes via localhost admin API when workspaces start/stop. Uses `CaddyRepository` from `@rockpool/caddy`.
- **Worker** -- separate container (`@rockpool/worker`). Picks up async jobs from ElasticMQ (create container, configure routes, teardown). Uses `RuntimeRepository` from `@rockpool/runtime`, `CaddyRepository` from `@rockpool/caddy`, and `QueueRepository` from `@rockpool/queue`.
- **ElasticMQ** -- SQS-compatible message queue for async workspace operations. Runs as a container (`softwaremill/elasticmq-native`).
- **Client** -- Vite dev server for SPA development, proxied by Caddy at `/app/`.

### 2. Workspace Containers

Each workspace is a Podman container running a custom Debian-based image with:

- code-server (web IDE, runs as container entrypoint)
- User's development tools and code

The workspace image is built with `podman build` from `images/workspace/Dockerfile`. Workspace data persists in Podman named volumes (`<name>-data` mounted at `/home/admin`).

Server and worker create workspace containers as siblings via the host's Podman socket. Containers are created with `-P` (publish all) and `--userns=auto` for rootless user namespace isolation.

See: [EDD 005: Workspace Image Pipeline](005_Workspace_Image_Pipeline.md), [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md), [ADR-017: code-server](../ADR/017-code-server-web-ide.md)

### 3. Ingress (Cloudflare Tunnel)

External access to the host without exposing ports or needing a static IP. The tunnel connects to Caddy's HTTP ports. Auth is handled by Caddy (basic auth) before requests reach the control plane or workspaces.

## Request Flow

### Creating a workspace

1. User opens SPA at `/app/`
2. User clicks "New Workspace"
3. SPA calls `POST /api/workspaces` with config (name, image)
4. Server validates and enqueues a create job on ElasticMQ
5. Worker picks up the job, creates a new Podman container via `RuntimeRepository`
6. Worker configures code-server inside the container via `podman exec`, then restarts the container
7. Worker waits for code-server to be ready (health check via native `fetch()` with `AbortSignal.timeout`)
8. Worker tells Caddy Service to add the workspace route:
   - `/workspace/{name}/*` -> container's mapped port (code-server)
9. Server updates workspace status to `running` (see [EDD 007](007_Data_Model.md) state machine)
10. SPA polls or receives status update, redirects to `/workspace/{name}/`

### Accessing a workspace

1. Browser requests `/workspace/foo/`
2. Caddy matches route, strips `/workspace/foo` prefix
3. Caddy proxies to the workspace container's mapped port on `host.containers.internal`
4. code-server serves the IDE
5. WebSocket connections (terminal, LSP) pass through transparently

### Port forwarding

1. User runs a dev server on port 3000 inside their workspace
2. User registers the port: `POST /api/workspaces/{id}/ports` with `{port: 3000}`
3. Server creates a Caddy route: `/workspace/foo/port/3000/*` -> `container_host:mapped_port`
4. User accesses their dev server at `/workspace/foo/port/3000/`

Ports are dynamic -- registered and unregistered on demand, up to 5 per workspace. See [EDD 007](007_Data_Model.md) for the Port entity and [EDD 003](003_Caddy_Reverse_Proxy.md) for the route structure.

## Network Architecture

### Isolation requirements

- Workspace containers MUST NOT access the host LAN or other workspace containers
- Workspace containers MUST have internet egress (for package managers, git, etc.)
- Control plane CAN reach all workspace containers via mapped ports
- Workspace containers communicate with the outside world ONLY via:
  - NAT for outbound internet
  - Caddy for inbound HTTP (proxied through mapped ports)

### Network topology

```
  Internet <--> Cloudflare Tunnel <--> Host
                                        |
                              Compose bridge network
                              (caddy, server, worker,
                               elasticmq, client)
                                        |
                              Caddy (:8080, :8081, :8082)
                                        |
                              Workspace containers
                           ws-a (127.0.0.1:44231)
                           ws-b (127.0.0.1:44232)
                                   |
                              NAT egress only
```

Workspace containers expose port 8080 via Podman's `-P` (publish all) flag, which maps the container's port to a random host port. Caddy proxies to `host.containers.internal:<mapped-port>`. Bridge IPs (10.88.0.x) are not used because they are unreachable from outside the container's user namespace in rootless mode.

## Deployment Targets

| Target        | OS    | Workspace Runtime | Control Plane    | Notes                              |
| ------------- | ----- | ----------------- | ---------------- | ---------------------------------- |
| Laptop (Mac)  | macOS | Podman (in Root VM) | podman compose (in Root VM) | Root VM via Tart, Virtiofs mount |
| Desktop/Server| Linux | Podman (on host)  | podman compose (on host) | Direct, no VM layer needed    |

See: [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md) for runtime evaluation. See: [EDD 022: Root VM](022_Root_VM.md) for the macOS Root VM setup.

## Open Questions

- [x] Authentication strategy -- basic auth in Caddy to start, upgradable to `forward_auth`
- [x] Workspace persistence -- persistent Podman named volumes, data survives stop/start (see [EDD 005](005_Workspace_Image_Pipeline.md))
- [x] Resource limits -- defaults: 2 CPU cores, 4 GB RAM per workspace via `--cpus` and `--memory`. Configurable per-workspace later if needed.
- [ ] Auto-shutdown -- idle detection and automatic container stop?
- [ ] Multi-user -- single user initially, but design for future multi-user?
