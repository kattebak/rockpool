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
| API spec | TypeSpec → OpenAPI, Zod, TypeScript types, Drizzle tables |
| Backend  | Express + express-openapi-validator                       |
| Database | SQLite + Drizzle ORM                                      |
| Frontend | React, shadcn/ui, TanStack Query/Router                   |
| Runtime  | Node.js >= 22, ES modules                                 |
| VMs      | Tart (macOS) / QEMU-KVM (Linux) + Podman workspaces      |
| Tooling  | Biome (lint/format), esbuild (bundle), node:test          |

## Quick Start

### macOS

```sh
brew install cirruslabs/cli/tart openjdk
cp development.env.example development.env   # fill in secrets
npm install                                   # builds TypeSpec, SDK, Root VM image
npm start                                     # boots VM, starts stack, tails logs
```

### Linux

```sh
sudo apt install qemu-system-x86 qemu-utils virtiofsd debootstrap grub-pc-bin
sudo usermod -aG kvm $USER                   # log out and back in
sudo bash images/root-vm/build-root-vm.sh    # build Root VM image
sudo chown -R $USER:$USER .qemu/
cp development.env.example development.env   # fill in secrets
npm install
npm start
```

### Either platform

`npm start` boots the Root VM, mounts the project directory via Virtiofs, and starts the full stack (ElasticMQ, Caddy, API server, worker, Vite dev server) inside it via PM2.

Edit files on the host — changes appear instantly in the VM. PM2 watches for changes and restarts the server automatically.

The dashboard is at `http://<vm-ip>:8080/app/workspaces` (macOS) or `http://localhost:8080/app/workspaces` (Linux, port-forwarded).

## Development

Requires Node.js >= 22.

```sh
npm install
npm run lint
npm run check
npm test
```

### `development.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `RUNTIME` | yes | `podman` (Root VM), `tart` (legacy macOS), or `stub` (no real workspaces) |
| `GITHUB_OAUTH_CLIENT_ID` | for OAuth | GitHub OAuth app client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | for OAuth | GitHub OAuth app client secret |
| `CADDY_USERNAME` / `CADDY_PASSWORD` | for basic auth | Fallback when OAuth is not configured |

Either GitHub OAuth **or** basic auth credentials must be set. See [doc/EDD/003_Caddy_Reverse_Proxy.md](doc/EDD/003_Caddy_Reverse_Proxy.md) appendix for GitHub OAuth setup.

### Useful commands

```sh
npm start              # boot VM + start stack + tail logs
npm stop               # stop PM2 inside the VM
npm run stop:vm        # shut down the VM
npm run ssh:vm         # SSH into the Root VM
npm run vm:logs        # tail PM2 logs from the VM
npm test               # run unit tests across all packages
npm run fix -- --unsafe  # format and lint
```

### Building the workspace image

The workspace container image must be built inside the Root VM:

```sh
npm run ssh:vm
# inside the VM:
podman build -t rockpool-workspace:latest /mnt/rockpool/images/workspace/
```

### E2E tests

```sh
npm run test:e2e:ci        # stub runtime, no containers needed
npm run test:e2e:podman    # real Podman containers (requires workspace image)
```

