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

## What Comes After

Once this vertical slice works, the next steps build out the package structure defined in [EDD 008](008_Package_Structure.md):

1. **`@tidepool/runtime`** -- `RuntimeRepository` with `TartRuntime` adapter wrapping the `tart` CLI (create, start, stop, delete, ip)
2. **`@tidepool/caddy`** -- `CaddyRepository` wrapping the Caddy admin API (add/remove workspace routes)
3. **`@tidepool/db`** -- Drizzle schema and connection, workspace persistence
4. **`@tidepool/queue`** -- `QueueRepository` wrapping ElasticMQ (SQS-compatible)
5. **`@tidepool/server`** -- Express control plane composing the above, workspace CRUD at `/api/workspaces` (see [EDD 007](007_Data_Model.md))
6. **`@tidepool/worker`** -- async workspace lifecycle (create VM, configure routes, update status)
7. **`@tidepool/client`** -- React SPA for workspace management at `/app/*`
8. **`@tidepool/runtime` Incus adapter** -- `IncusRuntime` for Linux support

## Next (MVP Followups)

- Resolve Alpine Tart base image access (public registry or authenticated pull)
- Run the Packer path end-to-end and switch default image back to Alpine
- Add cleanup/stop script for VM and Caddy route removal
