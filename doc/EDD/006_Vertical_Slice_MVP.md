# EDD: Vertical Slice MVP

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Draft      |
| Created | 2026-02-21 |
| Updated | 2026-02-21 |

## Summary

Minimal end-to-end proof of the Tidepool concept on macOS: a browser request hits Caddy, gets routed by path to a Tart VM running Alpine + code-server, and the user lands in a working IDE. Three components, no control plane services, no async workers -- just the critical path.

## Prerequisites

- [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md) -- Tart selected for macOS
- [EDD 003: Caddy Reverse Proxy](003_Caddy_Reverse_Proxy.md) -- path-based routing, admin API
- [EDD 004: Web IDE](004_Web_IDE.md) -- code-server selected
- [EDD 005: Workspace Image Pipeline](005_Workspace_Image_Pipeline.md) -- Alpine, Packer, local builds

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

| Aspect | MVP (this EDD) | Production |
|---|---|---|
| Caddy location | Host macOS (`brew install`) | Root VM (co-located with control plane) |
| Auth | None | Basic auth in Caddy, upgradable to `forward_auth` |
| Route structure | Flat route per workspace | Subroute with port forwarding (8081-8085) |
| URL scheme | `/workspace/test/*` only | `/api/*`, `/app/*`, `/workspace/{name}/*` |
| code-server base path | Baked into OpenRC service (`/workspace/test`) | Set via env var at VM boot (`/workspace/${WORKSPACE_NAME}`) |

## Scope

### In scope

- Packer template for Alpine + code-server Tart image
- Shared provisioning script (`alpine-setup.sh`)
- Manual `tart run` to start the VM
- Manual Caddy config to route `/workspace/test/*` to the VM
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
packer build images/alpine-workspace.pkr.hcl
```

Output: a Tart VM image named `tidepool-alpine` available via `tart list`.

## Component 2: Tart VM

### Start the VM

```bash
tart clone tidepool-alpine workspace-test
tart run workspace-test &
```

### Get the VM IP

```bash
tart ip workspace-test
# e.g. 192.168.64.5
```

### Verify code-server

```bash
VM_IP=$(tart ip workspace-test)

# Health check
curl http://$VM_IP:8080/healthz

# Verify base path is set (should redirect to /workspace/test/)
curl -sI http://$VM_IP:8080/ | grep -i location
```

## Component 3: Caddy Route

### Install and Run Caddy

For the MVP, Caddy runs on the host (not in the root VM). Production moves it inside the root VM alongside the control plane (see [EDD 003](003_Caddy_Reverse_Proxy.md)).

```bash
brew install caddy
caddy start
```

### Bootstrap Config

```bash
curl -X POST http://localhost:2019/load \
  -H "Content-Type: application/json" \
  -d '{
    "apps": {
      "http": {
        "servers": {
          "srv0": {
            "listen": [":8080"],
            "routes": []
          }
        }
      }
    }
  }'
```

### Add Workspace Route

```bash
VM_IP=$(tart ip workspace-test)

curl -X POST http://localhost:2019/config/apps/http/servers/srv0/routes \
  -H "Content-Type: application/json" \
  -d "{
    \"@id\": \"workspace-test\",
    \"match\": [{ \"path\": [\"/workspace/test/*\"] }],
    \"handle\": [
      {
        \"handler\": \"rewrite\",
        \"strip_path_prefix\": \"/workspace/test\"
      },
      {
        \"handler\": \"reverse_proxy\",
        \"upstreams\": [{ \"dial\": \"$VM_IP:8080\" }],
        \"flush_interval\": -1,
        \"stream_timeout\": \"24h\",
        \"stream_close_delay\": \"5s\"
      }
    ],
    \"terminal\": true
  }"
```

### Verify

Open `http://localhost:8080/workspace/test/` in a browser. code-server IDE should load with working terminal and file editor.

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

| Risk | Impact | Mitigation |
|---|---|---|
| Alpine + musl breaks code-server | Blocker | code-server ships standalone musl-compatible builds; fall back to Debian if needed |
| Tart Packer builder doesn't exist or is immature | Blocker | Fall back to manual `tart create` + `tart run` + SSH provisioning |
| code-server subfolder mounting breaks with WebSockets | High | `--abs-proxy-base-path` is designed for this; test early |
| Caddy and Tart compete for port 8080 | Low | Different networks -- Caddy on host :8080, code-server on VM :8080 |

## What Comes After

Once this vertical slice works, the next steps in order:

1. **Tart adapter** -- TypeScript wrapper around `tart` CLI (create, start, stop, delete, ip)
2. **Caddy service** -- TypeScript wrapper around Caddy admin API
3. **Wire them together** -- a single script that creates a workspace end-to-end
4. **Add ElasticMQ + Worker** -- async lifecycle management
5. **SPA** -- minimal workspace management UI
6. **Incus adapter** -- Linux support
