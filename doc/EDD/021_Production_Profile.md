# EDD: Production-like Local Profile

| Field        | Value                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Author       | mvhenten                                                                                                  |
| Status       | Draft                                                                                                     |
| Created      | 2026-02-28                                                                                                |
| Updated      | 2026-02-28                                                                                                |
| Related ADRs | [ADR-014](../ADR/014-build-tooling-conventions.md), [ADR-015](../ADR/015-three-port-origin-isolation.md)   |
| Related EDDs | [EDD-010](010_PM2_Process_Management.md), [EDD-001](001_Architecture_Overview.md)                         |

## Summary

Add a "production" environment profile for running Rockpool on a homelab or office server. It uses its own port range (10xxx), serves a pre-built (minified) client bundle, disables file watchers and hot reload, and binds Caddy to 0.0.0.0 so the instance is reachable from other machines on the LAN (e.g. `https://homelab:59007`).

This profile sits alongside the existing development (8080) and test (9080) profiles. All three can run simultaneously without port conflicts.

## Problem

The existing profiles serve different purposes:

| Profile       | Ports      | Client         | Watch | Accessible from LAN |
| ------------- | ---------- | -------------- | ----- | ------------------- |
| development   | 8080/8081  | Vite dev server | yes   | no (localhost)      |
| test          | 9080/9081  | pre-built dist  | no    | no (localhost)      |

Neither is suitable for running Rockpool as a persistent service on a homelab:

1. **Development** uses the Vite dev server with HMR and file watchers -- wasteful on a server, and fragile for long-running use.
2. **Test** uses an ephemeral DB (`/tmp/rockpool-e2e.db`) and is designed for throwaway E2E runs, not persistent data.
3. Neither binds Caddy to `0.0.0.0`, so they are unreachable from other machines on the LAN.

## Prerequisites

- [EDD-010](010_PM2_Process_Management.md) -- PM2 process management (ecosystem config pattern)
- [ADR-015](../ADR/015-three-port-origin-isolation.md) -- Three-port origin isolation (srv0, srv1, srv2)
- [ADR-014](../ADR/014-build-tooling-conventions.md) -- Build tooling conventions

## Design

### Port Allocation

The production profile uses the 10xxx range, mirroring the three-port isolation pattern:

| Service       | Port   | Notes                                     |
| ------------- | ------ | ----------------------------------------- |
| Caddy srv0    | 59007  | Control plane + SPA (API + `/app/*`)      |
| Caddy srv1    | 10081  | IDE sessions (`/workspace/{name}/*`)      |
| Caddy srv2    | 10082  | App previews (`/workspace/{name}/port/*`) |
| API server    | 10163  | Express control plane (behind Caddy)      |
| ElasticMQ     | 10324  | SQS-compatible queue                      |
| Caddy admin   | 10019  | Caddy admin API (localhost only)          |

### Network Binding

Caddy listens on `0.0.0.0:59007`, `0.0.0.0:10081`, `0.0.0.0:10082` so it is reachable from the LAN. The API server and ElasticMQ remain on localhost -- they are only accessed by Caddy and the worker, both co-located.

### Client Build

The production profile serves a pre-built client from `packages/client/dist`. The build is triggered by `npm run build -w packages/client` (Vite production build with minification). No Vite dev server runs in this profile.

### No File Watchers

The PM2 ecosystem config for this profile does not set `watch` on any process. Processes restart only on crash, not on file change.

### Persistent Database

The database lives at `rockpool-production.db` in the project root (not `/tmp`). This is a persistent store suitable for long-running use.

## File Layout

```
rockpool/
  production.env.sample                # template — copy to production.env and add credentials
  elasticmq.production.conf            # ElasticMQ config on port 10324
  ecosystem.production.config.cjs      # PM2 ecosystem config (no watch, no dev server)
  doc/EDD/021_Production_Profile.md    # this document
```

## Environment File

```env
# Production-like local profile
NODE_ENV=development
PORT=10163
SRV0_PORT=59007
SRV1_PORT=10081
DB_PATH=rockpool-production.db
SPA_ROOT=packages/client/dist

CADDY_ADMIN_URL=http://localhost:10019

QUEUE_ENDPOINT=http://localhost:10324
QUEUE_URL=http://localhost:10324/000000000000/workspace-jobs

GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
GITHUB_OAUTH_CALLBACK_URL=http://localhost:59007/api/auth/callback

FIRECRACKER_BASE_PATH=.firecracker
SSH_KEY_PATH=images/ssh/rockpool_ed25519

DASHBOARD_URL=http://localhost:59007
API_URL=http://localhost:59007/api
```

## Ecosystem Config

```javascript
// ecosystem.production.config.cjs
module.exports = {
  apps: [
    {
      name: "prod-elasticmq",
      script: "npm-scripts/setup-elasticmq.sh",
      args: "production",
      interpreter: "bash",
      autorestart: true,
      max_restarts: 3,
      restart_delay: 2000,
    },
    {
      name: "prod-caddy",
      script: "caddy",
      args: "run",
      interpreter: "none",
      env: {
        CADDY_ADMIN: "localhost:10019",
      },
      autorestart: true,
      max_restarts: 3,
      restart_delay: 2000,
    },
    {
      name: "prod-server",
      script: "packages/server/src/index.ts",
      interpreter: "node",
      interpreter_args: "--experimental-strip-types --env-file=production.env",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
    },
    {
      name: "prod-worker",
      script: "packages/worker/src/main.ts",
      interpreter: "node",
      interpreter_args: "--experimental-strip-types --env-file=production.env",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
```

Key differences from development ecosystem config:
- No `watch` on any process
- No client dev server process (SPA served from pre-built dist by Caddy)
- Uses `--env-file=production.env` for dedicated ports
- Process names prefixed with `prod-` to avoid collision with running dev/test processes

## npm Scripts

```json
{
  "prestart:production": "npm run build -w packages/client",
  "start:production": "pm2 delete ecosystem.production.config.cjs --silent; pm2 start ecosystem.production.config.cjs && pm2 logs",
  "stop:production": "pm2 delete ecosystem.production.config.cjs"
}
```

The `prestart:production` hook ensures the client is built before starting. `stop:production` only removes production processes, leaving dev/test processes untouched.

## ElasticMQ Config

```conf
include classpath("application.conf")

node-address {
  protocol = http
  host = localhost
  port = 10324
  context-path = ""
}

rest-sqs {
  enabled = true
  bind-port = 10324
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

## Testing Strategy

### Manual Verification

1. `npm run start:production` -- all four PM2 processes come online
2. `pm2 status` shows `prod-elasticmq`, `prod-caddy`, `prod-server`, `prod-worker`
3. Open `http://localhost:59007/app/workspaces` -- SPA loads (minified build)
4. Open `http://homelab:59007/app/workspaces` from another machine on the LAN -- same SPA loads
5. File changes in `packages/server/src` do NOT trigger restarts
6. `npm run stop:production` removes only production processes
7. Running `npm run dev` simultaneously does not conflict (different ports)

### Port Conflict Check

Verify all three profiles can run simultaneously:

```bash
npm run dev                  # development on 8080
npm run test:e2e:headless    # test on 9080 (auto-starts/stops)
npm run start:production     # production on 59007
```

## Open Questions

None -- this is a straightforward port allocation and config exercise following established patterns.
