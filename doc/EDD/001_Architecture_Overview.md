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
                    ┌───────┴────────┐
                    │     Caddy      │
                    │  :8080 (HTTP)  │
                    │  :2019 (admin) │
                    │                │
  /                 │  ──► Control   │  Control Plane VM
  /api/*            │      Plane     │  (SPA + API)
  /workspace/foo/*  │  ──► VM-foo    │  Workspace VM
  /workspace/bar/*  │  ──► VM-bar    │  Workspace VM
  /workspace/X/port/N/* ──► VM-X:N   │  Port forwarding
                    └────────────────┘
                            │
                    ┌───────┴────────┐
                    │   MicroVM Host │
                    │                │
                    │  Isolated net  │
                    │  NAT egress    │
                    │  No LAN access │
                    └────────────────┘
```

## Components

### 1. Caddy (Reverse Proxy)

Single entry point for all HTTP traffic. Configured dynamically via its admin API (`:2019`).

Responsibilities:
- Route requests to the correct VM based on URL path
- Strip path prefixes before forwarding
- Handle WebSocket upgrades (automatic in Caddy)
- TLS termination (when not behind Cloudflare)

See: [EDD 003: Caddy Reverse Proxy](003_Caddy_Reverse_Proxy.md)

### 2. Control Plane

Runs in its own microVM. Provides:
- **SPA** served at `/` -- workspace management UI
- **API** served at `/api/*` -- workspace CRUD, status
- **VM lifecycle management** -- create, start, stop, destroy microVMs
- **Caddy configuration** -- add/remove routes via Caddy admin API when workspaces change

### 3. Workspace VMs

Each workspace is an isolated microVM running:
- Full Linux userspace with systemd
- Web IDE (code-server or Coder agent)
- User's development tools and code

See: [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md), [EDD 004: Web IDE](004_Web_IDE.md)

### 4. Ingress (Cloudflare Tunnel)

External access to the host without exposing ports or needing a static IP. The tunnel connects to Caddy's HTTP port. All auth and access control happens at the Cloudflare or control plane level.

## Request Flow

### Creating a workspace

1. User opens SPA at `/`
2. User clicks "New Workspace"
3. SPA calls `POST /api/workspaces` with config (name, image, resources)
4. Control plane creates a new microVM
5. Control plane waits for VM to be ready (health check)
6. Control plane calls Caddy admin API to add routes:
   - `/workspace/{name}/*` → VM primary port (code-server)
   - Port forward routes added on demand
7. API returns workspace URL to SPA
8. SPA redirects to `/workspace/{name}/`

### Accessing a workspace

1. Browser requests `/workspace/foo/`
2. Caddy matches route, strips `/workspace/foo` prefix
3. Caddy proxies to VM-foo's code-server on internal IP
4. code-server serves the IDE
5. WebSocket connections (terminal, LSP) pass through transparently

### Port forwarding

1. User runs a dev server on port 3000 inside their workspace
2. User (or auto-detection) requests port forward via control plane API
3. Control plane adds Caddy route: `/workspace/foo/port/3000/*` → VM-foo:3000
4. User accesses their dev server at `/workspace/foo/port/3000/`

## Network Architecture

### Isolation requirements

- Workspace VMs MUST NOT have access to the host LAN
- Workspace VMs MUST have internet egress (for package managers, git, etc.)
- Workspace VMs communicate with the outside world ONLY via:
  - NAT for outbound internet
  - Caddy reverse proxy for inbound HTTP

### Network topology

```
  Internet ◄──► Host NAT ◄──► Isolated Bridge ◄──► VM tap devices
                                    │
                              No LAN routes
                              Only NAT egress
```

Each VM gets a tap device on an isolated bridge network. The host provides NAT for internet egress but does not route to the LAN subnet. Firewall rules (iptables/nftables) enforce this.

## Deployment Targets

| Target        | OS    | MicroVM Runtime          | Notes                          |
| ------------- | ----- | ------------------------ | ------------------------------ |
| Laptop (Mac)  | macOS | Lima or Tart (see EDD 002) | Runs Linux VMs via Apple Virtualization Framework |
| Office server | Linux | Incus or Firecracker (see EDD 002) | Native KVM, best performance |

## Open Questions

- [ ] Authentication strategy -- Cloudflare Access, OAuth, or simple shared secret?
- [ ] Workspace persistence -- how are workspace filesystems stored and restored?
- [ ] Resource limits -- how to cap CPU/RAM per workspace?
- [ ] Auto-shutdown -- idle detection and automatic VM stop?
- [ ] Multi-user -- single user initially, but design for future multi-user?
