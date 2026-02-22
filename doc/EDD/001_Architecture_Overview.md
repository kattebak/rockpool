# EDD: Tidepool Architecture Overview

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Draft      |
| Created | 2026-02-21 |
| Updated | 2026-02-22 |

## Summary

Tidepool is a lightweight cloud IDE platform inspired by Cloud9. It provides isolated development environments running in microVMs, accessible through a web browser via a unified reverse proxy. The system runs on a single host (laptop or office server) with external ingress via a reverse proxy service like Cloudflare Tunnel.

## Baseline Decisions (First Plan Anchors)

These are the explicit starting decisions for production planning beyond the MVP. Everything else in the plan assumes these unless revised.

- **Auth:** Single-user basic auth only (no external IdP, no multi-user login UI).
- **Auth upgrade path:** Ory/JWT is the likely next step, but out of scope for now.
- **Data retention:** Workspace disks persist on stop; delete is irreversible.
- **Lifecycle controls:** Manual start/stop only; no idle auto-stop or schedules.
- **Operations baseline:** Minimal local JSON logs only; no metrics, alerts, or centralized logging.
- **Image distribution:** Local builds only, no shared registry or distribution pipeline.
- **Routing scheme:** Path-based routing only; no subdomains.
- **Logs location:** File-based logs in a `.logs/<workspace-name>/` directory (revisit later).
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

```
                           Internet
                              │
                       Cloudflare Tunnel
                              │
                    ┌─────────┴──────────┐
                    │      Root VM       │
                    │                    │
                    │  Caddy             │
                    │  :8080 (API + SPA) │
                    │  :8081 (workspaces)│
                    │  + basic auth      │
                    │  + admin API       │
                    │    (:2019,         │
                    │     localhost only) │
                    │                    │
                    │  Control Plane     │
                    │  (:7163,           │
                    │   localhost only)  │
                    │                    │
                    │  ElasticMQ         │
                    └─────────┬──────────┘
                              │
  :8080                       │
  /app/*            ──► localhost:7163
  /api/*            ──► localhost:7163
                              │
  :8081                       │
  /workspace/foo/*  ──► VM-foo:8080      Workspace VM
  /workspace/bar/*  ──► VM-bar:8080      Workspace VM
  /workspace/X/port/N/* ──► VM-X:N       Dynamic, registered via API
                              │
                    ┌─────────┴──────────┐
                    │    MicroVM Host    │
                    │                    │
                    │  Isolated bridge   │
                    │  NAT egress only   │
                    │  No LAN access     │
                    └────────────────────┘
```

Ports `:8080` and `:8081` are separate browser origins, providing origin isolation between the control plane and workspace content. See [ADR-015](../ADR/015-two-port-origin-isolation.md).

## Components

### 1. Root VM

The root VM hosts both Caddy and the control plane. Everything runs on localhost — Caddy listens on two ports for origin isolation: `:8080` proxies `/app/*` and `/api/*` to the control plane on `localhost:7163`, while `:8081` proxies workspace routes to workspace VM IPs on the isolated bridge network. This split prevents workspace-hosted JavaScript from reaching the control plane API (different browser origin, no shared cookies). The Caddy admin API (`:2019`) is only accessible from localhost, so the control plane can configure routes directly.

#### Caddy (Reverse Proxy)

Entry point for all HTTP traffic, split across two ports for origin isolation. Configured dynamically via its admin API (`:2019`).

Responsibilities:

- Origin isolation between control plane (`:8080`) and workspaces (`:8081`)
- Route requests to the correct VM based on URL path
- Strip path prefixes before forwarding
- Handle WebSocket upgrades (automatic in Caddy)
- Basic auth (upgradable to `forward_auth` later)
- TLS termination (when not behind Cloudflare)

See: [EDD 003: Caddy Reverse Proxy](003_Caddy_Reverse_Proxy.md)

#### Control Plane

Composed of two services, a worker, and a message queue, all co-located in the root VM. The API server lives in `@tidepool/server` and the async worker in `@tidepool/worker` -- both compose integration packages (`@tidepool/runtime`, `@tidepool/caddy`, `@tidepool/queue`, `@tidepool/db`) via dependency injection. See [EDD 008: Package Structure](008_Package_Structure.md) for the full layout.

```
┌─────────────────────────────────────────────┐
│                  Root VM                    │
│                                             │
│  ┌──────────┐                                          │
│  │  Caddy   │ :8080 (API+SPA), :8081 (ws), :2019 (adm) │
│  └────┬─────┘                                          │
│       │ localhost                            │
│  ┌────┴─────────────┐  ┌─────────────────┐  │
│  │ Workspace Service│  │ Caddy Service   │  │
│  │ (CRUD, status)   │  │ (route config)  │  │
│  └────────┬─────────┘  └────────┬────────┘  │
│           │                     │            │
│  ┌────────┴─────────────────────┴────────┐  │
│  │         Workspace Worker              │  │
│  │   (async lifecycle via ElasticMQ)     │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  ElasticMQ (async job queue)          │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

- **Workspace Service** -- workspace CRUD and status, serves SPA at `/app/*` and API at `/api/*`. Workspace entity and status model defined in [EDD 007: Data Model](007_Data_Model.md).
- **Caddy Service** -- configures Caddy routes via localhost admin API when workspaces start/stop. Uses `CaddyRepository` from `@tidepool/caddy`.
- **Workspace Worker** -- separate process (`@tidepool/worker`). Picks up async jobs from ElasticMQ (create VM, configure routes, teardown). Uses `RuntimeRepository` from `@tidepool/runtime`, `CaddyRepository` from `@tidepool/caddy`, and `QueueRepository` from `@tidepool/queue`.
- **ElasticMQ** -- SQS-compatible message queue for async workspace operations

### 2. Workspace VMs

Each workspace is an isolated microVM running a custom lightweight Linux image with:

- code-server (web IDE)
- User's development tools and code

Base image is Alpine Linux, pre-built with Packer. Workspaces can be cloned via runtime-native snapshots.

See: [EDD 005: Workspace Image Pipeline](005_Workspace_Image_Pipeline.md)

See: [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md), [EDD 004: Web IDE](004_Web_IDE.md)

### 3. Ingress (Cloudflare Tunnel)

External access to the host without exposing ports or needing a static IP. The tunnel connects to Caddy's HTTP port inside the root VM. Auth is handled by Caddy (basic auth) before requests reach the control plane or workspace VMs.

## Request Flow

### Creating a workspace

1. User opens SPA at `/app/`
2. User clicks "New Workspace"
3. SPA calls `POST /api/workspaces` with config (name, image)
4. Workspace Service validates and enqueues a create job on ElasticMQ
5. Workspace Worker picks up the job, creates a new microVM via runtime adapter
6. Worker waits for VM to be ready (health check)
7. Worker tells Caddy Service to add the workspace route:
   - `/workspace/{name}/*` → VM primary port (code-server)
8. Workspace Service updates workspace status to `running` (see [EDD 007](007_Data_Model.md) state machine)
9. SPA polls or receives status update, redirects to `/workspace/{name}/`

### Accessing a workspace

1. Browser requests `/workspace/foo/`
2. Caddy matches route, strips `/workspace/foo` prefix
3. Caddy proxies to VM-foo's code-server on internal IP
4. code-server serves the IDE
5. WebSocket connections (terminal, LSP) pass through transparently

### Port forwarding

1. User runs a dev server on port 3000 inside their workspace
2. User registers the port: `POST /api/workspaces/{id}/ports` with `{port: 3000}`
3. Server creates a Caddy route: `/workspace/foo/port/3000/*` → `VM_IP:3000`
4. User accesses their dev server at `/workspace/foo/port/3000/`

Ports are dynamic -- registered and unregistered on demand, up to 5 per workspace. See [EDD 007](007_Data_Model.md) for the Port entity and [EDD 003](003_Caddy_Reverse_Proxy.md) for the route structure.

## Network Architecture

### Isolation requirements

- Workspace VMs MUST NOT access the host LAN or other workspace VMs
- Workspace VMs MUST have internet egress (for package managers, git, etc.)
- Root VM (Caddy + control plane) CAN reach all workspace VMs on the isolated bridge
- Workspace VMs communicate with the outside world ONLY via:
  - NAT for outbound internet
  - Caddy (in root VM) for inbound HTTP

### Network topology

```
  Internet ◄──► Cloudflare Tunnel ◄──► Root VM (Caddy + Control Plane)
                                            │
                                    Isolated Bridge
                                     ┌──────┼──────┐
                                   VM-foo VM-bar  VM-baz
                                     │      │      │
                                   NAT egress only
                                   No LAN routes
                                   No inter-VM traffic
```

All VMs (root + workspaces) sit on an isolated bridge network. The root VM can reach workspace VMs to proxy HTTP traffic. Workspace VMs have NAT egress for internet access but cannot reach the host LAN or each other. Firewall rules (iptables/nftables) enforce this.

## Deployment Targets

| Target        | OS    | MicroVM Runtime | Notes                                     |
| ------------- | ----- | --------------- | ----------------------------------------- |
| Laptop (Mac)  | macOS | Tart            | Native via Apple Virtualization Framework |
| Office server | Linux | Incus           | Native KVM, REST API, OVN networking      |

See: [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md) for full evaluation.

## Open Questions

- [x] Authentication strategy -- basic auth in Caddy to start, upgradable to `forward_auth`
- [x] Workspace persistence -- persistent VM disk, runtime-native snapshots for cloning (see [EDD 005](005_Workspace_Image_Pipeline.md))
- [x] Resource limits -- defaults: 2 CPU cores, 4 GB RAM per workspace. Both Tart (`--cpu`, `--memory`) and Incus (`limits.cpu`, `limits.memory`) support this at VM creation. Configurable per-workspace later if needed.
- [ ] Auto-shutdown -- idle detection and automatic VM stop?
- [ ] Multi-user -- single user initially, but design for future multi-user?
