# Rockpool

Cloud IDE platform. Isolated development environments in microVMs, accessible via browser.

## Architecture

- **Workspace VMs**: Tart (macOS) or Firecracker (Linux) microVMs running Debian with code-server
- **Reverse proxy**: Caddy with path-based routing, dynamically configured via admin API
- **Control plane**: Workspace Service (CRUD), Caddy Service (routing), Workspace Worker (async jobs via ElasticMQ)
- **Frontend**: React SPA for workspace management

See [doc/EDD/](doc/EDD/) for detailed design documents and [doc/ADR/](doc/ADR/) for technology decisions.

## Tech Stack

| Layer    | Technology                                                |
| -------- | --------------------------------------------------------- |
| API spec | TypeSpec → OpenAPI, Zod, TypeScript types, Drizzle tables |
| Backend  | Express + express-openapi-validator                       |
| Database | SQLite + Drizzle ORM                                      |
| Frontend | React, shadcn/ui, TanStack Query/Router                   |
| Runtime  | Node.js >= 22, ES modules                                 |
| VMs      | Tart (macOS) / Firecracker (Linux)                        |
| Tooling  | Biome (lint/format), esbuild (bundle), node:test          |

## Host Setup

Rockpool auto-detects the platform and uses the appropriate VM runtime. Run `make setup` to install prerequisites for your OS.

### Linux (Firecracker)

Requires an x86_64 host with KVM support (bare metal or nested virtualization enabled).

```sh
sudo npm-scripts/linux-setup.sh
```

This script installs all dependencies in one shot:
- System packages: `build-essential`, `debootstrap`, `default-jre-headless`, `jq`, `curl`
- Caddy web server (system service disabled — Rockpool manages it)
- KVM group membership for your user
- `rockpool0` network bridge with NAT
- Firecracker binary and kernel
- ext4 rootfs image (40GB sparse, built via debootstrap)
- Sudoers entry for TAP device management
- `development.env` with `RUNTIME=firecracker`

After setup, log out and back in if you were added to the `kvm` group, then:

```sh
npm install
npx playwright install chromium
```

### macOS (Tart)

```sh
brew install cirruslabs/cli/tart openjdk
make all    # builds TypeSpec, SDK, and VM image via Packer
```

### Either platform

```sh
make setup   # detects OS and runs the appropriate setup
```

## Development

```sh
npm install
npm run lint
npm run check
npm test
```

Requires Node.js >= 22.

## Running

```sh
make development.env   # create development.env from template (fill in secrets)
make all              # build everything (TypeSpec, SDK, client, VM image)
npm run dev           # start API server + worker + client dev server
```

See [doc/EDD/003_Caddy_Reverse_Proxy.md](doc/EDD/003_Caddy_Reverse_Proxy.md) appendix for local setup details (GitHub OAuth, `development.env`).

## Production Profile (LAN Server)

For running Rockpool as a persistent service on your local network (e.g., a homelab):

```sh
cp production.env.sample production.env  # fill in GitHub OAuth credentials
npm run start:production                 # builds client, starts all services on port 59007
npm run stop:production                  # stops only production processes
```

Access from any machine on your network at `http://<hostname>:59007/app/workspaces`.

| Profile     | Port  | File watchers | Client        | Bind      |
| ----------- | ----- | ------------- | ------------- | --------- |
| development | 8080  | yes           | vite dev      | localhost |
| test        | 9080  | no            | n/a           | localhost |
| production  | 59007 | no            | minified      | 0.0.0.0   |

All three profiles can run simultaneously without port conflicts. See [doc/EDD/021_Production_Profile.md](doc/EDD/021_Production_Profile.md) for details.
