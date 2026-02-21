# EDD: Tidepool Architecture Overview

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Draft      |
| Created | 2026-02-21 |
| Updated | 2026-02-21 |

## Summary

Tidepool is a lightweight cloud IDE platform inspired by Cloud9. It provides isolated development environments running in microVMs, accessible through a web browser via a unified reverse proxy. The system runs on a single host (laptop or office server) with external ingress via a reverse proxy service like Cloudflare Tunnel.

## System Topology

```
                           Internet
                              │
                       Cloudflare Tunnel
                              │
                    ┌─────────┴──────────┐
                    │      Root VM       │
                    │                    │
                    │  Caddy (:8080)     │
                    │  + basic auth      │
                    │  + admin API       │
                    │    (:2019,         │
                    │     localhost only) │
                    │                    │
                    │  Control Plane     │
                    │  (:3000,           │
                    │   localhost only)  │
                    │                    │
                    │  ElasticMQ         │
                    └─────────┬──────────┘
                              │
  /app/*            ──► localhost:3000
  /api/*            ──► localhost:3000
  /workspace/foo/*  ──► VM-foo:8080      Workspace VM
  /workspace/bar/*  ──► VM-bar:8080      Workspace VM
  /workspace/X/port/N/* ──► VM-X:N       Ports 8081-8085
                              │
                    ┌─────────┴──────────┐
                    │    MicroVM Host    │
                    │                    │
                    │  Isolated bridge   │
                    │  NAT egress only   │
                    │  No LAN access     │
                    └────────────────────┘
```

## Components

### 1. Root VM

The root VM hosts both Caddy and the control plane. Everything runs on localhost — Caddy proxies `/app/*` and `/api/*` to the control plane on `localhost:3000`, while workspace routes proxy to workspace VM IPs on the isolated bridge network. The Caddy admin API (`:2019`) is only accessible from localhost, so the control plane can configure routes directly.

#### Caddy (Reverse Proxy)

Single entry point for all HTTP traffic. Configured dynamically via its admin API (`:2019`).

Responsibilities:
- Route requests to the correct VM based on URL path
- Strip path prefixes before forwarding
- Handle WebSocket upgrades (automatic in Caddy)
- Basic auth (upgradable to `forward_auth` later)
- TLS termination (when not behind Cloudflare)

See: [EDD 003: Caddy Reverse Proxy](003_Caddy_Reverse_Proxy.md)

#### Control Plane

Composed of three services and a message queue, all co-located in the root VM:

```
┌─────────────────────────────────────────────┐
│                  Root VM                    │
│                                             │
│  ┌──────────┐                               │
│  │  Caddy   │ :8080 (public), :2019 (local) │
│  └────┬─────┘                               │
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

- **Workspace Service** -- workspace CRUD and status, serves SPA at `/app/*` and API at `/api/*`
- **Caddy Service** -- configures Caddy routes via localhost admin API when workspaces start/stop
- **Workspace Worker** -- picks up async jobs from ElasticMQ (create VM, clone workspace, teardown)
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
3. SPA calls `POST /api/workspaces` with config (name, image, resources)
4. Workspace Service validates and enqueues a create job on ElasticMQ
5. Workspace Worker picks up the job, creates a new microVM via runtime adapter
6. Worker waits for VM to be ready (health check)
7. Worker tells Caddy Service to add routes:
   - `/workspace/{name}/*` → VM primary port (code-server)
   - `/workspace/{name}/port/{8081-8085}/*` → fixed forwarded ports
8. Workspace Service updates workspace status
9. SPA polls or receives status update, redirects to `/workspace/{name}/`

### Accessing a workspace

1. Browser requests `/workspace/foo/`
2. Caddy matches route, strips `/workspace/foo` prefix
3. Caddy proxies to VM-foo's code-server on internal IP
4. code-server serves the IDE
5. WebSocket connections (terminal, LSP) pass through transparently

### Port forwarding

1. User runs a dev server on port 8081 inside their workspace
2. Port forwarding routes (8081-8085) are provisioned when the workspace is created
3. User accesses their dev server at `/workspace/foo/port/8081/`

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

| Target        | OS    | MicroVM Runtime | Notes                          |
| ------------- | ----- | --------------- | ------------------------------ |
| Laptop (Mac)  | macOS | Tart            | Native via Apple Virtualization Framework |
| Office server | Linux | Incus           | Native KVM, REST API, OVN networking |

See: [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md) for full evaluation.

## Open Questions

- [x] Authentication strategy -- basic auth in Caddy to start, upgradable to `forward_auth`
- [x] Workspace persistence -- persistent VM disk, runtime-native snapshots for cloning (see [EDD 005](doc/EDD/005_Workspace_Image_Pipeline.md))
- [ ] Resource limits -- how to cap CPU/RAM per workspace?
- [ ] Auto-shutdown -- idle detection and automatic VM stop?
- [ ] Multi-user -- single user initially, but design for future multi-user?
