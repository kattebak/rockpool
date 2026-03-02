# EDD: Podman Compose Control Plane

| Field        | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| Author       | mvhenten                                                       |
| Status       | Draft                                                          |
| Created      | 2026-03-02                                                     |
| Updated      | 2026-03-02                                                     |
| Related ADRs | [ADR-014](../ADR/014-build-tooling-conventions.md)             |
| Related EDDs | [EDD-010](010_PM2_Process_Management.md), [EDD-022](022_Root_VM.md) |

## Summary

Replace PM2 with Podman Compose for control plane orchestration. The five services (Caddy, API server, worker, ElasticMQ, Vite client) become containers defined in a single `compose.yaml`. The same file works on the host (fast dev iteration), in GitHub Actions CI, and inside the Root VM (production). PM2 and all its ecosystem configs are removed. The Root VM image shrinks to just Podman + SSH.

## Motivation

The current PM2 setup has accumulated seven ecosystem config files for different profiles. Each profile requires Node.js, Java (ElasticMQ), and Caddy installed on the host or in the Root VM. Adding a new profile means copying another ecosystem config and adjusting ports.

Podman Compose solves this:

- **One compose file, multiple contexts.** The same `compose.yaml` runs on the developer's machine, in CI, and inside the Root VM. Environment files control ports and runtime selection.
- **Container images replace provisioning.** Node.js, Caddy, ElasticMQ, and Podman CLI are in OCI images, not installed via `apt` or `fnm`. Rebuilding takes seconds, not minutes.
- **Root VM becomes minimal.** The VM image only needs Podman and SSH. No Node.js, no Java, no Caddy. Smaller image, smaller attack surface, faster builds.
- **CI parity.** GitHub-hosted runners have Podman pre-installed. `podman compose up` in CI gives the same stack as local dev.
- **No PM2 dependency.** Compose handles process lifecycle, restart policies, and log aggregation. Node.js `--watch` replaces PM2 file watching.

## Prerequisites

- [EDD-022: Root VM with Podman workspaces](022_Root_VM.md) — Podman runtime, Root VM infrastructure
- [EDD-010: PM2 Process Management](010_PM2_Process_Management.md) — the system being replaced
- Podman with compose support on the host (`podman compose` or `podman-compose`)

## Architecture

### System topology

```
┌──────────────────────────────────────────────┐
│  Host (or Root VM)                           │
│                                              │
│  podman compose up                           │
│  ┌────────────────────────────────────────┐  │
│  │ compose stack (network_mode: host)     │  │
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
│  Podman socket ──────────────────────┐       │
│                                      │       │
│  ┌────────┐ ┌────────┐    server/worker      │
│  │ ws-a   │ │ ws-b   │    create these       │
│  │ :44231 │ │ :44232 │    via socket         │
│  └────────┘ └────────┘                       │
└──────────────────────────────────────────────┘
```

### network_mode: host

All control plane containers use `network_mode: host`. This means they share the host's (or VM's) network namespace directly — no container networking, no port mapping needed in compose. Every service binds to `localhost:<its-port>`, exactly like the current PM2 setup.

This is the right choice because:

- Caddy must reach workspace containers at `127.0.0.1:<mapped-port>`. With compose networking, workspace containers (created outside the compose stack) would be unreachable.
- It matches the current model where all processes share the network. No behavioral change.
- It avoids compose DNS, bridge networks, and extra_hosts configuration.

### Workspace containers as siblings

Server and worker mount the host's Podman socket. The `podman` CLI inside the control plane container uses `CONTAINER_HOST=unix:///run/podman.sock` to talk to the host's Podman service. Workspace containers are created as siblings — managed by the host's Podman, on the host's network. The existing `podman-runtime.ts` works unchanged.

```
compose stack ──(podman socket)──► host Podman ──► workspace containers
```

### Three contexts, one compose file

| Context        | VM  | How compose runs                                       |
| -------------- | --- | ------------------------------------------------------ |
| **Development**| no  | `podman compose up` on the host                        |
| **CI**         | no  | `podman compose up` on GitHub runner                   |
| **Production** | yes | `podman compose up` inside the Root VM (over SSH)      |

The only difference between contexts is the `.env` file passed to compose, controlling ports, `RUNTIME`, and `NODE_ENV`.

## compose.yaml

```yaml
services:
  caddy:
    image: caddy:2
    network_mode: host
    command: caddy run --resume
    restart: unless-stopped
    volumes:
      - caddy-data:/data
      - caddy-config:/config

  elasticmq:
    image: softwaremill/elasticmq-native
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./${ELASTICMQ_CONF:-elasticmq.conf}:/opt/elasticmq.conf:ro

  server:
    build: images/control-plane
    network_mode: host
    working_dir: /app
    command: node --experimental-strip-types packages/server/src/index.ts
    env_file: ${ENV_FILE:-development.env}
    environment:
      CONTAINER_HOST: unix:///run/podman.sock
    restart: unless-stopped
    volumes:
      - .:/app
      - rockpool-data:/opt/rockpool
      - ${XDG_RUNTIME_DIR}/podman/podman.sock:/run/podman.sock
    depends_on:
      - caddy
      - elasticmq

  worker:
    build: images/control-plane
    network_mode: host
    working_dir: /app
    command: node --experimental-strip-types packages/worker/src/main.ts
    env_file: ${ENV_FILE:-development.env}
    environment:
      CONTAINER_HOST: unix:///run/podman.sock
    restart: unless-stopped
    volumes:
      - .:/app
      - rockpool-data:/opt/rockpool
      - ${XDG_RUNTIME_DIR}/podman/podman.sock:/run/podman.sock
    depends_on:
      - caddy
      - elasticmq

  client:
    build: images/control-plane
    network_mode: host
    working_dir: /app
    command: npx vite --config packages/client/vite.config.ts
    env_file: ${ENV_FILE:-development.env}
    restart: unless-stopped
    volumes:
      - .:/app

volumes:
  caddy-data:
  caddy-config:
  rockpool-data:
```

### compose.override.yaml (dev defaults, auto-loaded)

```yaml
services:
  server:
    command: node --watch --experimental-strip-types packages/server/src/index.ts
```

The override adds `--watch` for automatic restart on file changes during development. In production (inside the Root VM), run `podman compose -f compose.yaml up` to skip the override.

### Dev mode: host-side Vite

The compose stack includes a Vite container serving on `:5173`, proxied by Caddy at `/app/`. For faster HMR iteration, stop the client container and run Vite on the host:

```bash
podman compose stop client
npm run dev -w client          # Vite on host, same port 5173
```

Or run host Vite on a different port and access it directly, bypassing Caddy.

## Control Plane Image

```dockerfile
# images/control-plane/Dockerfile
FROM node:22-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends podman && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
```

Minimal image: Node.js 22 + Podman CLI. The project source and `node_modules` are bind-mounted from the host. No `npm install` inside the container.

The `podman` CLI uses `CONTAINER_HOST=unix:///run/podman.sock` (set in compose) to talk to the host's Podman service. All `podman create`, `podman exec`, `podman port` commands in `podman-runtime.ts` are routed through the socket.

## Root VM Impact

### Before (EDD-022)

The Root VM image installs via `setup-root-vm.sh`:

- Node.js (via fnm)
- PM2 (global)
- Caddy (from apt repo)
- ElasticMQ (Java JRE + JAR)
- Podman
- SSH server
- build-essential, python3, vim, tmux, etc.

### After

The Root VM image installs only:

- Podman (+ `podman-compose` or `podman compose` support)
- SSH server
- virtiofs mount support

Everything else moves into container images. `setup-root-vm.sh` shrinks from ~130 lines to ~40 lines.

### Root VM workflow

```bash
# Host side
npm run start:vm                    # boot VM, wait for SSH

# Inside the VM (via SSH)
cd /mnt/rockpool
podman compose up -d                # start the control plane
podman compose logs -f              # tail logs

# Or from the host (one command)
npm run start:rootvm                # boot VM + compose up over SSH
```

## Profile Configuration

Environment files replace ecosystem configs:

| File              | Context          | Key settings                                    |
| ----------------- | ---------------- | ----------------------------------------------- |
| `development.env` | Dev on host      | RUNTIME=podman, ports 8080-8082, SPA_PROXY_URL  |
| `test.env`        | E2E tests        | RUNTIME=stub, ports 9080-9082                   |
| `podman-test.env` | Podman E2E       | RUNTIME=podman, ports 9080-9082                 |
| `rootvm-test.env` | Root VM E2E      | RUNTIME=stub, ports 9080-9082                   |
| `ci.env`          | GitHub Actions   | RUNTIME=stub, ports 9080-9082                   |

The compose file reads `ENV_FILE` to select the right environment:

```bash
# Development (default)
podman compose up

# E2E tests
ENV_FILE=test.env podman compose up -d

# CI
ENV_FILE=ci.env podman compose up -d
```

### ElasticMQ configuration

ElasticMQ config files (`elasticmq.conf`, `elasticmq.test.conf`) are mounted into the container. The `ELASTICMQ_CONF` variable selects which one:

```bash
# Dev (default)
ELASTICMQ_CONF=elasticmq.conf podman compose up

# Test
ELASTICMQ_CONF=elasticmq.test.conf ENV_FILE=test.env podman compose up
```

## npm Script Changes

### Before

```json
{
  "start": "pm2 delete all --silent; pm2 start ecosystem.caddy.config.cjs && pm2 logs",
  "stop": "pm2 delete all",
  "dev": "pm2 delete all --silent; pm2 start ecosystem.config.cjs && pm2 logs"
}
```

### After

```json
{
  "start": "npm-scripts/start.sh",
  "stop": "npm-scripts/stop.sh",
  "dev": "podman compose up",
  "dev:stop": "podman compose down",
  "dev:logs": "podman compose logs -f",
  "dev:status": "podman compose ps"
}
```

`npm-scripts/start.sh` detects context: if a Root VM is configured, it boots the VM and runs `podman compose up` over SSH. Otherwise, it runs `podman compose up` locally.

## E2E Test Changes

### global-setup.ts

Replace PM2 commands with compose commands:

```typescript
function composeCmd(args: string): string {
    const envFile = process.env.ENV_FILE ?? "test.env";
    const base = `podman compose --env-file ${envFile}`;

    if (IS_ROOTVM) {
        return sshCmd(`cd /mnt/rockpool && ${base} ${args}`);
    }

    return `${base} ${args}`;
}

export default async function globalSetup(): Promise<void> {
    execSync(composeCmd("down"), { stdio: "ignore" });
    execSync(composeCmd("up -d"), { stdio: "inherit" });

    await ensureQueue();
    await pollUntilReady(`${API_URL}/health`, 60_000);
    // ...
}
```

### global-teardown.ts

```typescript
export default async function globalTeardown(): Promise<void> {
    execSync(composeCmd("down"), { stdio: "ignore" });
}
```

### E2E profiles

| Profile          | Command                                                | Compose env                |
| ---------------- | ------------------------------------------------------ | -------------------------- |
| `test:e2e:ci`    | `ENV_FILE=ci.env npx playwright test ...`              | stub runtime, test ports   |
| `test:e2e:podman`| `ENV_FILE=podman-test.env npx playwright test ...`     | podman runtime, test ports |
| `test:e2e:rootvm`| `E2E_PROFILE=rootvm ENV_FILE=rootvm-test.env npx ...`  | stub, compose over SSH     |

## Impact on Existing Code

### No changes needed

- `packages/runtime/src/podman-runtime.ts` — `execFile("podman", ...)` works via `CONTAINER_HOST` socket
- `packages/caddy/` — Caddy admin API unchanged, bootstrapped programmatically
- `packages/server/src/index.ts` — env-based config, no PM2 awareness
- `packages/worker/src/main.ts` — same
- `packages/client/` — Vite config unchanged

### Removed

| File                              | Reason                            |
| --------------------------------- | --------------------------------- |
| `ecosystem.config.cjs`           | Replaced by compose.yaml          |
| `ecosystem.caddy.config.cjs`     | Replaced by compose.yaml          |
| `ecosystem.test.config.cjs`      | Replaced by compose.yaml + env    |
| `ecosystem.production.config.cjs`| Replaced by compose.yaml + env    |
| `ecosystem.rootvm.config.cjs`    | Replaced by compose.yaml + env    |
| `ecosystem.rootvm-test.config.cjs`| Replaced by compose.yaml + env   |
| `ecosystem.podman-test.config.cjs`| Replaced by compose.yaml + env   |
| `npm-scripts/setup-elasticmq.sh` | Replaced by container image       |
| `.elasticmq/` directory          | JAR no longer needed              |

### Modified

| File                              | Change                            |
| --------------------------------- | --------------------------------- |
| `e2e/global-setup.ts`            | PM2 → compose commands            |
| `npm-scripts/start.sh`           | PM2 → compose                     |
| `npm-scripts/stop.sh`            | PM2 → compose                     |
| `npm-scripts/start-rootvm.sh`    | PM2 over SSH → compose over SSH   |
| `npm-scripts/stop-rootvm.sh`     | PM2 over SSH → compose over SSH   |
| `npm-scripts/preflight.sh`       | Check for podman/compose, not java|
| `images/root-vm/setup-root-vm.sh`| Remove Node, Java, Caddy installs |
| `Makefile`                        | Add control-plane image target    |
| `package.json`                    | Update npm scripts                |

### New

| File                              | Purpose                           |
| --------------------------------- | --------------------------------- |
| `compose.yaml`                   | Control plane service definitions  |
| `compose.override.yaml`          | Dev defaults (--watch)             |
| `images/control-plane/Dockerfile`| Node.js + Podman CLI image         |
| `ci.env`                         | CI environment config              |

## Scope

### In scope

- `compose.yaml` with five services (Caddy, server, worker, ElasticMQ, client)
- Control plane Dockerfile (Node.js + Podman CLI)
- ElasticMQ container replaces Java JAR
- npm script migration from PM2 to compose
- E2E global-setup/teardown migration
- Root VM `setup-root-vm.sh` simplification
- Makefile target for control plane image
- Dev workflow with `--watch` via compose override

### Out of scope

- Podman REST API (keep using CLI via socket for now)
- Production hardening (TLS, resource limits, health checks in compose)
- macOS Tart Root VM adaptation (deferred, Linux/QEMU first)
- Multi-stage production image (COPY source instead of bind mount)

## Rollout Plan

### Phase 1: compose.yaml + control plane image (host dev)

**Goal:** `podman compose up` on the host starts the full stack. Developer can create workspaces, access the dashboard, and iterate on code.

**Steps:**

1. Create `images/control-plane/Dockerfile`
2. Write `compose.yaml` and `compose.override.yaml`
3. Create `ci.env`
4. Update `npm-scripts/start.sh` and `npm-scripts/stop.sh`
5. Update `npm-scripts/preflight.sh`
6. Add Makefile target for control plane image
7. Update `package.json` scripts

**Verification:**

- `podman compose up` starts all five services
- `http://localhost:8080/app/workspaces` loads the dashboard
- Creating a workspace works (Podman runtime via socket)
- `podman compose down` shuts everything down cleanly
- `node --watch` restarts server on file changes

### Phase 2: E2E tests via compose

**Goal:** All E2E profiles use compose instead of PM2. `test:e2e:ci` passes on the host.

**Steps:**

1. Rewrite `e2e/global-setup.ts` to use compose commands
2. Add `global-teardown.ts` for compose down
3. Update npm scripts for E2E profiles
4. Verify stub runtime works via compose
5. Verify podman runtime works via compose

**Verification:**

- `npm run test:e2e:ci` passes (stub runtime, compose on host)
- `npm run test:e2e:podman` passes (podman runtime, compose on host)

### Phase 3: Root VM simplification

**Goal:** The Root VM image contains only Podman + SSH. The control plane runs as compose containers inside the VM.

**Steps:**

1. Strip `setup-root-vm.sh` down to Podman + SSH + virtiofs
2. Update `npm-scripts/start-rootvm.sh` to run `podman compose up` over SSH
3. Update `npm-scripts/stop-rootvm.sh` to run `podman compose down` over SSH
4. Rebuild and test the Root VM image
5. Update `npm-scripts/vm-logs.sh` to use `podman compose logs`

**Verification:**

- Root VM boots and accepts SSH
- `podman compose up` inside the VM starts the full stack
- `npm run test:e2e:rootvm` passes from the host
- Root VM image is smaller

### Phase 4: CI pipeline

**Goal:** GitHub Actions runs E2E tests using compose.

**Steps:**

1. Update CI workflow to install `podman-compose` (if not already available)
2. Build control plane image in CI
3. Run `ENV_FILE=ci.env podman compose up -d`
4. Run Playwright tests
5. `podman compose down`

**Verification:**

- CI pipeline passes with compose-based test stack
- No PM2 references remain in the codebase

## Open Questions

- [ ] **Podman socket permissions.** When the control plane container runs as a non-root user, the mounted Podman socket may not be accessible. Verify that `CONTAINER_HOST` + socket mount works with rootless Podman. May need `user: "${UID}:${GID}"` in compose or socket permission adjustments.
- [ ] **`podman compose` vs `podman-compose`.** Podman 4.x has `podman compose` as a built-in subcommand. Older versions need the separate `podman-compose` Python package. Determine minimum Podman version and document accordingly.
- [ ] **Container image caching in CI.** Building the control plane image on every CI run adds time. Evaluate GitHub Actions cache for Podman layers or a container registry.
- [ ] **`node_modules` in bind mount performance.** The host's `node_modules` are bind-mounted into the container. On Linux this is native speed. Inside the Root VM (virtiofs), `npm install` may be slow — same issue as EDD-022. Keep `node_modules` on the virtiofs mount for now and optimize later if needed.
