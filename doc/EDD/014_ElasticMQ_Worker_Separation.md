# EDD: ElasticMQ & Worker Process Separation

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Author       | mvhenten                                                 |
| Status       | Implemented                                              |
| Created      | 2026-02-23                                               |
| Updated      | 2026-02-23                                               |
| Related EDDs | [EDD-010](010_PM2_Process_Management.md) (Phase 2)       |

## Summary

Run the worker as a separate PM2 process in all modes (dev and dev:caddy), using ElasticMQ as the SQS-compatible queue. Remove the `WORKER_INLINE` / `createMemoryQueue` code path — one queue implementation, one worker process, same topology everywhere.

## Problem

The current dev+caddy mode runs the worker in-process with the server via `WORKER_INLINE=true` and `createMemoryQueue`. This causes:

1. **Crash coupling** — a runtime error in provisioning (e.g. SSH timeout) can destabilize the server process.
2. **Dev/prod divergence** — dev uses MemoryQueue + inline worker, prod uses SQS + separate worker. Bugs in queue serialization or worker lifecycle are invisible in dev.
3. **Unnecessary complexity** — two queue implementations and a `WORKER_INLINE` flag to maintain.

## Prerequisites

- [EDD-010](010_PM2_Process_Management.md) — PM2 ecosystem configs
- JRE in PATH (for ElasticMQ)

## Design

### ElasticMQ

ElasticMQ is a lightweight SQS-compatible message queue backed by an in-memory store. Single JAR file, starts in ~1 second, no configuration needed for a single default queue.

Default endpoint: `http://localhost:9324`

Queue auto-creation: ElasticMQ creates queues on first use with in-memory storage (the default). No setup required — the first `SendMessage` call creates the queue.

### ElasticMQ Setup Script

Self-downloading launcher script at `npm-scripts/setup-elasticmq.sh`:

```bash
#!/bin/bash
set -e

ELASTICMQ_VERSION="1.6.9"
ELASTICMQ_JAR=".elasticmq/elasticmq-server.jar"
ELASTICMQ_URL="https://s3-eu-west-1.amazonaws.com/softwaremill-public/elasticmq-server-${ELASTICMQ_VERSION}.jar"

if [ ! -f "$ELASTICMQ_JAR" ]; then
    echo "Downloading ElasticMQ ${ELASTICMQ_VERSION}..."
    mkdir -p .elasticmq
    curl -L -o "$ELASTICMQ_JAR" "$ELASTICMQ_URL"
fi

exec java -Dconfig.file=elasticmq.conf -jar "$ELASTICMQ_JAR"
```

PM2 runs this script directly — it downloads the JAR on first run, then `exec`s Java. The `.elasticmq/` directory is gitignored.

### ElasticMQ Config

Minimal `elasticmq.conf` at the project root:

```hocon
include classpath("application.conf")

node-address {
  protocol = http
  host = localhost
  port = 9324
  context-path = ""
}

rest-sqs {
  enabled = true
  bind-port = 9324
  bind-hostname = "0.0.0.0"
  sqs-limits = strict
}

queues {
  workspace-jobs {
    defaultVisibilityTimeout = 120 seconds
    delay = 0 seconds
    receiveMessageWait = 0 seconds
  }
}
```

Visibility timeout of 120 seconds accommodates VM provisioning (clone + boot + SSH + health check).

### Ecosystem Config Changes

Both ecosystem configs get ElasticMQ + worker:

```javascript
// ecosystem.caddy.config.cjs (and ecosystem.config.cjs)
module.exports = {
  apps: [
    {
      name: "elasticmq",
      script: "npm-scripts/setup-elasticmq.sh",
      interpreter: "bash",
      autorestart: true,
      max_restarts: 3,
      restart_delay: 2000,
    },
    {
      name: "caddy",
      // ... unchanged
    },
    {
      name: "server",
      script: "npm",
      args: "run start -w packages/server",
      // remove WORKER_INLINE from env
    },
    {
      name: "worker",
      script: "npm",
      args: "run start -w packages/worker",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
    {
      name: "client",
      // ... unchanged (caddy config omits this)
    },
  ],
};
```

### Server Changes

- Remove the `WORKER_INLINE` code path from `packages/server/src/index.ts` — the server always uses `createSqsQueue` and never imports `@rockpool/worker`.
- Remove `createMemoryQueue` from `@rockpool/queue` (dead code).
- Remove `inlineWorker`, `createPollLoop`, `createProcessor` imports from server index.
- Keep `recoverOrphanedWorkspaces` and `recoverRunningWorkspaces` in the server — these run at startup and enqueue jobs via the SQS queue for the worker to pick up.

### Worker Changes

- `packages/worker/src/main.ts` needs the `--env-file=../../development.env` flag in its start script, same as the server.
- Pass `sshKeyPath` to `createTartRuntime` — resolve relative to project root (same pattern as server config).

## Implementation Plan

1. Create `npm-scripts/setup-elasticmq.sh` (self-downloading launcher).
2. Create `elasticmq.conf` with `workspace-jobs` queue.
3. Add `.elasticmq/` to `.gitignore`.
4. Add `elasticmq` and `worker` processes to both ecosystem configs.
5. Remove `WORKER_INLINE` env and inline worker startup from server index.
6. Update worker `main.ts`: add `--env-file`, pass `sshKeyPath` to runtime.
7. Remove `createMemoryQueue` and `WORKER_INLINE` references.
8. Add `java` check to preflight script.
9. Verify: `npm run dev` starts elasticmq + server + worker + client, workspace create flows through SQS to worker.

## Testing

- Create workspace via UI → verify job appears in worker logs (not server logs).
- Kill worker process → PM2 restarts it, pending jobs are retried (message stays visible after timeout).
- Kill ElasticMQ → server `send()` fails, returns error to client. Worker reconnects on restart.

## Open Questions

- [ ] Do we need a custom visibility timeout, or is 120s sufficient for all provisioning scenarios?
