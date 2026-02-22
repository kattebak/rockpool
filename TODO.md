# TODO

## Completed

1. [x] Replace bash-based dev process management with PM2 per [doc/EDD/010_PM2_Process_Management.md](doc/EDD/010_PM2_Process_Management.md). Created `ecosystem.config.cjs` (dev mode) and `ecosystem.caddy.config.cjs` (dev+caddy mode). Removed `npm-scripts/dev.sh` and `npm-scripts/dev-caddy.sh`. Added `dev:stop`, `dev:status`, `dev:logs` scripts.
2. [x] Add `X-Forwarded-Prefix` on workspace routes (not just port routes) as described in [doc/EDD/003_Caddy_Reverse_Proxy.md](doc/EDD/003_Caddy_Reverse_Proxy.md). Header now set on the `reverse_proxy` handler in `buildWorkspaceRoute()`.
3. [x] Enforce workspace caps and concurrency limits from [doc/EDD/007_Data_Model.md](doc/EDD/007_Data_Model.md). Max 999 workspaces, max 3 concurrent starts. Enforced in `workspace-service.create()` and `workspace-service.start()`. Added `countWorkspaces` and `countWorkspacesByStatus` queries to `@tdpl/db`.

## Deferred

4. [ ] Caddy rate limiting (EDD-003, EDD-007). Verified: **not implemented**. Rate limiting requires Caddy modules (`caddy-security`, `caddy-limiter`) which need a custom Caddy binary built with `xcaddy`. This is production hardening work, not an MVP gap. The standard Caddy binary does not include rate limiting. Defer to when a custom Caddy build pipeline is set up.
