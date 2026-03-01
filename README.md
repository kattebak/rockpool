# Rockpool

Cloud IDE platform. Isolated development environments in microVMs, accessible via browser.

## Architecture

- **Workspaces**: Podman rootless containers (Linux) or Tart microVMs (macOS) running Debian with code-server
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
| VMs      | Podman (Linux) / Tart (macOS)                             |
| Tooling  | Biome (lint/format), esbuild (bundle), node:test          |

## Host Setup

Rockpool auto-detects the platform and uses the appropriate workspace runtime.

### Linux (Podman)

Podman rootless containers provide isolated workspaces without requiring KVM or root privileges at runtime.

**Prerequisites:**

```sh
sudo apt install podman buildah
```

**Build the workspace image:**

```sh
podman build -t rockpool-workspace:latest images/workspace/
```

**Setup:**

```sh
npm install
npx playwright install chromium
```

Set `RUNTIME=podman` in your `development.env` to use the Podman runtime.

See [doc/EDD/022_Root_VM.md](doc/EDD/022_Root_VM.md) for the full architecture and optional Root VM setup (QEMU/KVM host with Podman inside the VM).

### Root VM (advanced)

For running the entire control plane inside a QEMU/KVM virtual machine with Podman workspaces:

**Prerequisites:**

```sh
sudo apt install qemu-system-x86 qemu-utils debootstrap virtiofsd
```

**Build the Root VM image** (requires sudo for debootstrap/chroot):

```sh
sudo bash images/root-vm/build-root-vm.sh
sudo chown -R $USER .qemu/
```

**Build the workspace image inside the VM:**

```sh
npm run start:rootvm          # boot the VM
npm run ssh:rootvm            # SSH into it
# inside the VM:
podman build -t rockpool-workspace:latest images/workspace/
```

See [doc/EDD/022_Root_VM.md](doc/EDD/022_Root_VM.md) for detailed setup, networking, and E2E testing instructions.

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

Requires Node.js >= 22.

```sh
npm install
npm run lint
npm run check
npm test
```

## Running

```sh
cp development.env.example development.env   # create development.env, fill in secrets
make all                                      # build TypeSpec, SDK, client
npm run dev                                   # start full stack via PM2
```

`npm run dev` starts five processes via PM2: ElasticMQ, Caddy, API server, worker, and Vite dev server. The dashboard is at `http://localhost:8080/app/workspaces` (or `http://<hostname>:8080/` from your LAN).

### `development.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `RUNTIME` | yes | `podman` (Linux), `tart` (macOS), or `stub` (no real workspaces) |
| `GITHUB_OAUTH_CLIENT_ID` | for OAuth | GitHub OAuth app client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | for OAuth | GitHub OAuth app client secret |
| `CADDY_USERNAME` / `CADDY_PASSWORD` | for basic auth | Fallback when OAuth is not configured |

Either GitHub OAuth **or** basic auth credentials must be set. See [doc/EDD/003_Caddy_Reverse_Proxy.md](doc/EDD/003_Caddy_Reverse_Proxy.md) appendix for GitHub OAuth setup.

### Useful commands

```sh
npm run dev            # start full stack (ElasticMQ, Caddy, server, worker, client)
npm run stop           # stop all PM2 processes
npx pm2 logs           # tail all process logs
npx pm2 list           # show process status
npm test               # run unit tests across all packages
npm run fix -- --unsafe  # format and lint
```

### E2E tests

```sh
npm run test:e2e:ci        # stub runtime, no containers needed
npm run test:e2e:podman    # real Podman containers (requires podman + workspace image)
```

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
