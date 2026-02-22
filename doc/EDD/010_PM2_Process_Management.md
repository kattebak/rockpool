# EDD: PM2 Process Management

| Field        | Value                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Author       | mvhenten                                                                                                  |
| Status       | Draft                                                                                                     |
| Created      | 2026-02-22                                                                                                |
| Updated      | 2026-02-22                                                                                                |
| Related ADRs | [ADR-005](../ADR/005-node22-esm.md), [ADR-014](../ADR/014-build-tooling-conventions.md)                   |
| Related EDDs | [EDD-001](001_Architecture_Overview.md), [EDD-006](006_Vertical_Slice_MVP.md), [EDD-008](008_Package_Structure.md) |

## Summary

Replace the hand-rolled bash PID management in `dev.sh` and `dev-caddy.sh` with PM2 and an ecosystem config file. PM2 gives us unified process lifecycle (start, stop, restart, logs) for all root VM services — Caddy, API server, worker, client dev server — through a single `pm2 start ecosystem.config.cjs` command. This also lays the groundwork for production process management inside the root VM, and is a prerequisite for the Tidepool-on-Tidepool demo ([RFC-002](../RFC/002_Tidepool_On_Tidepool.md)) where reliable process supervision inside a nested host VM is essential.

## Problem

The root VM runs multiple long-lived processes that must be coordinated:

| Process            | Port  | When              | Notes                                       |
| ------------------ | ----- | ----------------- | ------------------------------------------- |
| Caddy              | 8080, 8081, 2019 | dev:caddy, prod  | Reverse proxy, separate binary              |
| API server         | 7163  | always            | Express control plane                       |
| Worker             | —     | prod (standalone) | Poll loop, separate process with SQS        |
| Client dev server  | 5173  | dev only          | esbuild dev server with API proxy           |
| ElasticMQ          | 9324  | prod              | SQS-compatible queue, Java process          |

Today these are managed by two bash scripts with manual PID arrays and trap handlers:

```bash
# Current approach (dev.sh)
PIDS=()
cleanup() {
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
}
trap cleanup EXIT INT TERM
NODE_ENV=test npm run start -w packages/server &
PIDS+=($!)
npm run dev -w packages/client &
PIDS+=($!)
wait
```

Problems with this approach:

1. **No log management** — all output goes to the terminal, interleaved and unsearchable.
2. **No restart on crash** — if the API server dies, the dev session is broken until manual restart.
3. **Fragile cleanup** — orphaned processes on unclean exit (SIGKILL, terminal close).
4. **No status visibility** — can't check which processes are running without `ps aux | grep`.
5. **Dev/prod divergence** — production will need a proper process manager anyway; the bash approach doesn't scale to the root VM.
6. **Tidepool-on-Tidepool** — RFC-002 requires running a full stack (Caddy + server + worker + queue) inside a nested host VM with reliable lifecycle management.

## Prerequisites

- [ADR-005](../ADR/005-node22-esm.md) — Node.js >= 22, ES modules
- [ADR-014](../ADR/014-build-tooling-conventions.md) — Build tooling conventions (scripts in npm-scripts/, Makefile for artifacts)
- [EDD-001](001_Architecture_Overview.md) — Root VM runs Caddy + control plane + worker + queue

## Why PM2

PM2 is the standard Node.js process manager. It handles exactly the problem space we have:

- **Ecosystem config file** — declarative process definitions with environment variables, restart policies, and log paths.
- **Log management** — per-process stdout/stderr log files with timestamps. Supports `pm2 logs` for tail and `pm2 flush` for cleanup. Log rotation via `pm2-logrotate` module.
- **Restart policies** — `autorestart`, `max_restarts`, `restart_delay`, `max_memory_restart`. Crashed processes come back without intervention.
- **Process lifecycle** — `pm2 start`, `pm2 stop`, `pm2 restart`, `pm2 delete`, `pm2 status`. One command to start/stop the entire stack.
- **Non-Node processes** — PM2 can manage any executable (Caddy, ElasticMQ). Use `interpreter: "none"` for binaries and shell scripts.
- **Startup scripts** — `pm2 startup` + `pm2 save` persists the process list across reboots. Critical for the production root VM.
- **Graceful shutdown** — configurable `kill_timeout`, sends SIGINT before SIGKILL.
- **Watch mode** — built-in file watching with configurable paths and ignore patterns. Useful for dev mode auto-restart.

### Alternatives Considered

| Alternative    | Why not                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------- |
| bash scripts   | Current approach. No logs, no restart, fragile cleanup.                                     |
| systemd        | Linux-only. Not available on macOS. Can't use for dev mode.                                 |
| docker-compose | Adds container overhead. Tidepool runs on bare metal / inside VMs, not in containers.       |
| supervisord    | Python dependency. PM2 is already in the Node ecosystem.                                    |
| nodemon        | Dev-only, single process. Not a process manager.                                            |

## Ecosystem Config

The ecosystem file is a CommonJS module (`ecosystem.config.cjs`) because PM2 does not support ESM config files. It lives at the project root.

### Dev Mode (`npm run dev`)

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "server",
      script: "npm",
      args: "run start -w packages/server",
      cwd: __dirname,
      env: {
        NODE_ENV: "test",
      },
      watch: ["packages/server/src"],
      watch_delay: 1000,
      ignore_watch: ["node_modules", "*.test.ts"],
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
    },
    {
      name: "client",
      script: "npm",
      args: "run dev -w packages/client",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 1000,
    },
  ],
};
```

In dev mode the server runs with `NODE_ENV=test`, which activates MemoryQueue, StubRuntime, StubCaddy, and the in-process worker. The client dev server proxies `/api/*` to `:7163`.

### Dev + Caddy Mode (`npm run dev:caddy`)

```javascript
// ecosystem.caddy.config.cjs
module.exports = {
  apps: [
    {
      name: "caddy",
      script: "caddy",
      args: "run --config '' --adapter ''",
      interpreter: "none",
      autorestart: true,
      max_restarts: 3,
      restart_delay: 2000,
    },
    {
      name: "server",
      script: "npm",
      args: "run start -w packages/server",
      cwd: __dirname,
      env: {
        WORKER_INLINE: "true",
        SPA_ROOT: "./build/client",
      },
      watch: ["packages/server/src"],
      watch_delay: 1000,
      ignore_watch: ["node_modules", "*.test.ts"],
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
    },
  ],
};
```

Caddy runs as a non-Node process (`interpreter: "none"`). The server bootstraps Caddy config on startup (API proxy, SPA serving, auth) and runs the worker in-process with `WORKER_INLINE=true`.

### Production Mode (root VM)

```javascript
// ecosystem.prod.config.cjs
module.exports = {
  apps: [
    {
      name: "caddy",
      script: "caddy",
      args: "run --config '' --adapter ''",
      interpreter: "none",
      autorestart: true,
      max_restarts: 5,
      restart_delay: 3000,
      kill_timeout: 5000,
    },
    {
      name: "server",
      script: "npm",
      args: "run start -w packages/server",
      cwd: "/opt/tidepool",
      env: {
        NODE_ENV: "production",
        PORT: "7163",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      kill_timeout: 5000,
      max_memory_restart: "512M",
    },
    {
      name: "worker",
      script: "npm",
      args: "run start -w packages/worker",
      cwd: "/opt/tidepool",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      kill_timeout: 5000,
      max_memory_restart: "256M",
    },
    {
      name: "elasticmq",
      script: "java",
      args: "-jar /opt/elasticmq/elasticmq-server.jar",
      interpreter: "none",
      autorestart: true,
      max_restarts: 3,
      restart_delay: 5000,
    },
  ],
};
```

In production the worker runs as a separate process (real SQS via ElasticMQ, not MemoryQueue). ElasticMQ is managed as a non-Node process.

## Log Management

PM2 writes per-process logs to `~/.pm2/logs/` by default:

```
~/.pm2/logs/
  server-out.log      # stdout
  server-error.log    # stderr
  client-out.log
  client-error.log
  caddy-out.log
  caddy-error.log
```

### Log Commands

| Command                     | Description                              |
| --------------------------- | ---------------------------------------- |
| `pm2 logs`                  | Tail all process logs (interleaved)      |
| `pm2 logs server`           | Tail server logs only                    |
| `pm2 logs --lines 100`      | Show last 100 lines                      |
| `pm2 flush`                 | Clear all log files                      |

### Log Rotation (Production)

Install the `pm2-logrotate` module for production:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

This replaces the "file-based logs in `.logs/<workspace-name>/`" plan from EDD-001 with PM2-managed logs. The baseline decision for "minimal local JSON logs only" is preserved — Pino structured logs go to stdout, PM2 captures them to files.

## Updated npm Scripts

The existing dev scripts become thin wrappers around PM2:

```json
{
  "scripts": {
    "dev": "pm2 start ecosystem.config.cjs && pm2 logs",
    "dev:caddy": "npm run build -w packages/client && pm2 start ecosystem.caddy.config.cjs && pm2 logs",
    "dev:stop": "pm2 delete all",
    "dev:status": "pm2 status",
    "dev:logs": "pm2 logs"
  }
}
```

The old `dev.sh` and `dev-caddy.sh` scripts are replaced. The `dev:stop` script provides clean shutdown. `dev:status` provides the process table view PM2 is known for.

### Starting with real Tart VMs

```bash
RUNTIME=tart npm run dev:caddy
```

Environment variables flow through to the server process via PM2. The ecosystem config can also define `env_tart` variants if needed.

## Process Status Table

After `pm2 start ecosystem.caddy.config.cjs`:

```
┌────┬─────────┬──────┬───────┬────────┬─────────┬────────┐
│ id │ name    │ mode │ pid   │ status │ restart │ cpu    │
├────┼─────────┼──────┼───────┼────────┼─────────┼────────┤
│ 0  │ caddy   │ fork │ 12345 │ online │ 0       │ 0.1%   │
│ 1  │ server  │ fork │ 12346 │ online │ 0       │ 1.2%   │
└────┘─────────┴──────┴───────┴────────┴─────────┴────────┘
```

## Startup Script (Production / Tidepool-on-Tidepool)

For the production root VM and the nested host in RFC-002, PM2 must start on boot:

```bash
pm2 startup          # generates systemd/init script
pm2 start ecosystem.prod.config.cjs
pm2 save             # persists process list for reboot
```

After reboot, PM2 resurrects all saved processes automatically. This is critical for the inner host in the Tidepool-on-Tidepool demo where the developer expects services to be running after VM boot.

## Implementation Plan

### Phase 1: Dev Mode Ecosystem Config

1. Add `pm2` as a devDependency in the root `package.json`.
2. Create `ecosystem.config.cjs` for dev mode (server + client).
3. Create `ecosystem.caddy.config.cjs` for dev+caddy mode (caddy + server).
4. Update `package.json` scripts: `dev`, `dev:caddy`, `dev:stop`, `dev:status`, `dev:logs`.
5. Remove `npm-scripts/dev.sh` and `npm-scripts/dev-caddy.sh`.
6. Verify: `npm run dev` starts both processes, `pm2 logs` shows interleaved output, `pm2 status` shows the process table, `npm run dev:stop` shuts everything down.

### Phase 2: Production Ecosystem Config

1. Create `ecosystem.prod.config.cjs` (caddy + server + worker + elasticmq).
2. Add `pm2-logrotate` configuration.
3. Document `pm2 startup` + `pm2 save` for boot persistence.
4. Add to the workspace image build (EDD-005) so PM2 is preinstalled in the root VM.

### Phase 3: Tidepool-on-Tidepool Integration

1. Include PM2 and the production ecosystem config in the nested host image (RFC-002).
2. Add a boot script that runs `pm2 start ecosystem.prod.config.cjs` on VM init.
3. The developer can then `pm2 logs` to see all inner services, `pm2 status` to check health.

## File Layout

```
tidepool/
  ecosystem.config.cjs          # dev mode (server + client)
  ecosystem.caddy.config.cjs    # dev + caddy mode
  ecosystem.prod.config.cjs     # production (root VM)
  package.json                  # updated scripts
  npm-scripts/
    dev.sh                      # removed
    dev-caddy.sh                # removed
```

## Testing Strategy

### Manual Verification

- `npm run dev` → `pm2 status` shows server + client online
- `npm run dev:caddy` → `pm2 status` shows caddy + server online
- Kill a process manually (`kill <pid>`) → PM2 restarts it within `restart_delay`
- `pm2 logs server` → shows Pino JSON output
- `npm run dev:stop` → all processes removed, ports freed
- `RUNTIME=tart npm run dev:caddy` → server starts with Tart runtime

### Edge Cases

- Starting `npm run dev` when processes are already running → PM2 handles gracefully (restart or error with "already running")
- Port conflicts → PM2 logs show the error, process goes to "errored" state after `max_restarts`
- Caddy binary not found → PM2 marks the process as errored immediately

## Open Questions

- [ ] Should we use a single ecosystem config with `--only` flag to select profiles, or separate files per mode?
- [ ] Should the watch feature be enabled by default in dev mode, or left as opt-in?
- [ ] Do we want `pm2 monit` (dashboard TUI) as a dev script?

## Appendix

### PM2 Key Config Options

| Option              | Type          | Description                                                |
| ------------------- | ------------- | ---------------------------------------------------------- |
| `script`            | string        | Path to script or command to run                           |
| `args`              | string        | Arguments passed to the script                             |
| `interpreter`       | string        | Interpreter (e.g. `"none"` for binaries)                   |
| `cwd`               | string        | Working directory                                          |
| `env`               | object        | Environment variables                                      |
| `watch`             | bool/string[] | Watch paths for auto-restart                               |
| `watch_delay`       | number        | Delay (ms) before restart on file change                   |
| `ignore_watch`      | string[]      | Glob patterns to exclude from watch                        |
| `autorestart`       | boolean       | Restart on crash (default: true)                           |
| `max_restarts`      | number        | Max consecutive unstable restarts before erroring          |
| `restart_delay`     | number        | Delay (ms) before restart attempt                          |
| `max_memory_restart`| string        | Restart if memory exceeds threshold (e.g. `"512M"`)        |
| `kill_timeout`      | number        | Time (ms) before SIGKILL after SIGINT                      |
| `log_date_format`   | string        | Timestamp format for log lines                             |

### PM2 Key Commands

| Command                          | Description                          |
| -------------------------------- | ------------------------------------ |
| `pm2 start ecosystem.config.cjs` | Start all defined processes          |
| `pm2 stop all`                   | Stop all processes                   |
| `pm2 restart all`                | Restart all processes                |
| `pm2 delete all`                 | Remove all processes from PM2        |
| `pm2 status`                     | Show process table                   |
| `pm2 logs [name]`                | Tail logs (all or specific process)  |
| `pm2 flush`                      | Clear all log files                  |
| `pm2 monit`                      | Terminal dashboard                   |
| `pm2 startup`                    | Generate boot startup script         |
| `pm2 save`                       | Save current process list for reboot |
