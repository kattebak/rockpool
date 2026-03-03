# ADR-017: code-server as Web IDE

**Date**: 2026-02-21
**Status**: Accepted
**Updated**: 2026-03-03

## Context

Each Rockpool workspace needs a browser-accessible IDE. The two candidates are full Coder (coderd control plane + agents) and code-server standalone. The key constraint is Rockpool's path-based routing — no wildcard subdomains.

Coder requires wildcard subdomains (`*.coder.example.com`) for web IDE access and explicitly does not support path-based routing. This is a hard blocker.

## Decision

Use code-server standalone in each workspace container.

code-server supports path-based routing natively via `--abs-proxy-base-path /workspace/{name}`. It runs as the container entrypoint (PID 1) in each workspace Podman container, with no external dependencies (no PostgreSQL, no Terraform, no control plane server).

The workspace container uses a custom `entrypoint.sh` that starts code-server. Configuration (bind address, auth mode, proxy base path) is written to `~/.config/code-server/config.yaml` via `podman exec` during provisioning. An optional workspace folder path is read from `~/.config/code-server/workspace-folder` and passed as a positional argument. Changes take effect after `podman restart`.

```bash
# entrypoint.sh (inside workspace container)
#!/bin/sh
FOLDER_FILE="$HOME/.config/code-server/workspace-folder"
FOLDER=""
if [ -f "$FOLDER_FILE" ]; then
    FOLDER="$(cat "$FOLDER_FILE")"
fi
exec code-server --bind-addr=0.0.0.0:8080 --auth=none $FOLDER
```

Auth is `none` because authentication is handled at the Caddy/control plane level (ADR-015), not per-workspace.

Features we forgo (Terraform templates, JetBrains Gateway, multi-user dashboard, RBAC) are either low-impact or will be built incrementally in Rockpool's own control plane.

## Consequences

- Path-based routing works without wildcard DNS or wildcard TLS certificates.
- Each workspace container is self-contained — no inter-service dependencies for the IDE.
- Lower resource overhead — no coderd server or PostgreSQL to run.
- Idle detection and auto-stop must be implemented in Rockpool's control plane.
- Extension marketplace choice (Open VSX vs Microsoft) remains open.
- Configuration uses `podman exec` to write files, then `podman restart` to apply. No SSH into workspaces.
