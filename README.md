# Rockpool

Cloud IDE platform. Isolated development environments in Podman containers inside a Linux VM, accessible via browser.

## Architecture

- **Root VM**: Linux VM (Tart on macOS, QEMU/KVM on Linux) runs the entire control plane
- **Workspaces**: Podman rootless containers inside the Root VM running Debian with code-server
- **Reverse proxy**: Caddy with path-based routing, dynamically configured via admin API
- **Control plane**: Workspace Service (CRUD), Caddy Service (routing), Workspace Worker (async jobs via ElasticMQ)
- **Frontend**: React SPA for workspace management

See [doc/EDD/](doc/EDD/) for detailed design documents and [doc/ADR/](doc/ADR/) for technology decisions.

## Tech Stack

| Layer    | Technology                                                |
| -------- | --------------------------------------------------------- |
| API spec | TypeSpec -> OpenAPI, Zod, TypeScript types, Drizzle tables |
| Backend  | Express + express-openapi-validator                       |
| Database | SQLite + Drizzle ORM                                      |
| Frontend | React, shadcn/ui, TanStack Query/Router                   |
| Runtime  | Node.js >= 22, ES modules                                 |
| VMs      | Tart (macOS) / QEMU-KVM (Linux) + Podman workspaces      |
| Tooling  | Biome (lint/format), esbuild (bundle), node:test          |

## Quick Start

### macOS

```sh
brew install cirruslabs/cli/tart
make rockpool.config.json              # creates config from example template
npm install                            # builds TypeSpec, SDK, Root VM image
npm start                              # boots VM, starts stack, tails logs
```

### Linux

```sh
sudo apt install qemu-system-x86 qemu-utils mmdebstrap e2fsprogs fakeroot
sudo usermod -aG kvm $USER            # log out and back in
make rockpool.config.json              # creates config from example template
npm install
npm run vm -- build                    # build Root VM image (no sudo needed)
npm start
```

### Either platform

`npm start` boots the Root VM, mounts the project directory via Virtiofs, and starts the full stack (ElasticMQ, Caddy, API server, worker, Vite dev server) inside it via Podman Compose.

Edit files on the host -- changes appear instantly in the VM. Node.js `--watch` restarts the server automatically on file changes.

The dashboard is at `http://<vm-ip>:8080/app/workspaces` (macOS) or `http://localhost:8080/app/workspaces` (Linux, port-forwarded).

## Configuration

Rockpool uses JSON config files validated by a zod schema (`@rockpool/config`). See [EDD-027](doc/EDD/EDD-027-configuration-package.md) for full details.

| File | Purpose | Committed |
|------|---------|-----------|
| `rockpool.config.example.json` | Template for local dev | Yes |
| `rockpool.config.json` | Local dev config (gitignored) | No |
| `rockpool.test.config.json` | E2E test profile (host-side) | Yes |
| `rockpool.compose.config.json` | Dev compose (container-internal URLs) | Yes |
| `rockpool.compose.test.config.json` | Test compose (container-internal URLs) | Yes |

Either GitHub OAuth **or** basic auth credentials must be configured in the `auth` section. See [doc/EDD/003_Caddy_Reverse_Proxy.md](doc/EDD/003_Caddy_Reverse_Proxy.md) appendix for GitHub OAuth setup.

## Development

Requires Node.js >= 22.

```sh
npm install
npm run lint
npm run check
npm test
```

### Useful commands

```sh
npm start                          # boot VM + start stack + tail logs
npm stop                           # stop compose stack inside the VM
npm run vm -- start                # boot the VM, wait for SSH
npm run vm -- stop                 # shut down the VM
npm run vm -- deploy               # rsync code + npm ci on VM
npm run vm -- up                   # podman compose up -d on VM
npm run vm -- down                 # podman compose down on VM
npm run vm -- restart              # podman compose restart on VM
npm run vm -- logs                 # tail compose logs from VM
npm run vm -- ssh                  # SSH into the Root VM
npm test                           # run unit tests across all packages
npm run fix -- --unsafe            # format and lint
```

### Building the workspace image

The workspace container image must be built inside the Root VM:

```sh
npm run vm -- ssh
# inside the VM:
podman build -t rockpool-workspace:latest /mnt/rockpool/images/workspace/
```

### E2E tests

```sh
npm run test:e2e:headless          # real Podman containers, headless Playwright
```
