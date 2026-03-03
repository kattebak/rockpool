# EDD: PM2 Process Management

| Field        | Value                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Author       | mvhenten                                                                                                  |
| Status       | **Superseded by [EDD-025: Compose Control Plane](025_Compose_Control_Plane.md)**                         |
| Created      | 2026-02-22                                                                                                |
| Updated      | 2026-03-03                                                                                                |
| Related ADRs | [ADR-005](../ADR/005-node22-esm.md), [ADR-014](../ADR/014-build-tooling-conventions.md)                   |
| Related EDDs | [EDD-001](001_Architecture_Overview.md), [EDD-025](025_Compose_Control_Plane.md) |

## Superseded

This EDD has been fully superseded by [EDD-025: Compose Control Plane](025_Compose_Control_Plane.md).

PM2 and all ecosystem config files (`ecosystem.*.config.cjs`) have been removed from the codebase. The control plane (Caddy, server, worker, ElasticMQ, client) now runs via `podman compose` with a single `compose.yaml` and environment-specific `.env` files.

Key changes:
- `pm2 start/stop/logs` replaced by `podman compose up/down/logs`
- Seven ecosystem config files replaced by one `compose.yaml` + env files
- Node.js `--watch` (via `compose.override.yaml`) replaces PM2 file watching
- ElasticMQ runs as a container image, not a Java JAR managed by PM2
- Root VM image no longer needs Node.js, Java, or PM2 installed

See [EDD-025](025_Compose_Control_Plane.md) for the current architecture.

---

The original EDD content is preserved below for historical reference.

## Original Summary

Replace the hand-rolled bash PID management in `dev.sh` and `dev-caddy.sh` with PM2 and an ecosystem config file. PM2 gives us unified process lifecycle (start, stop, restart, logs) for all root VM services -- Caddy, API server, worker, client dev server -- through a single `pm2 start ecosystem.config.cjs` command.

## Original Problem

The root VM ran multiple long-lived processes coordinated by bash scripts with manual PID arrays and trap handlers. PM2 was selected to provide log management, restart on crash, status visibility, and file watching.

## Why PM2 Was Later Replaced

PM2 served well during the transition from bash scripts to structured process management. However, EDD-025 identified that Podman Compose provided the same benefits (lifecycle management, log aggregation, restart policies) while also containerizing the control plane services. This eliminated the need for Node.js, Java, and Caddy to be installed directly on the host or Root VM.
