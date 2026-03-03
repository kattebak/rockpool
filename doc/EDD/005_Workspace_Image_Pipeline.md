# EDD: Workspace Image Pipeline

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Accepted   |
| Created | 2026-02-21 |
| Updated | 2026-03-03 |

## Summary

Defines how Rockpool builds and stores workspace container images. The workspace image is a Dockerfile built with `podman build`. It produces a standard OCI container image used by the Podman runtime for all workspaces.

The original Packer-based pipeline (Tart OCI images, ext4 rootfs) has been replaced. Workspace images are now standard Dockerfiles.

## Prerequisites

- [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md) -- Podman rootless selected as workspace runtime
- [ADR-017: code-server](../ADR/017-code-server-web-ide.md) -- code-server selected as the IDE

## Image Requirements

| Requirement                  | Priority | Notes                                             |
| ---------------------------- | -------- | ------------------------------------------------- |
| Lightweight base             | Must     | Debian bookworm-slim                              |
| code-server pre-installed    | Must     | Ready to serve IDE on container start             |
| No Docker dependency         | Must     | Built with `podman build`                         |
| OCI container image          | Must     | Standard Dockerfile, any OCI runtime              |
| Single base image to start   | Must     | Add more image variants later                     |
| Reproducible builds          | Should   | Same Dockerfile produces same image               |

## Decision

### Base Distro: Debian bookworm-slim

Debian bookworm-slim provides broad binary compatibility in a minimal container image. No systemd -- code-server runs as the container entrypoint (PID 1).

### Build Tool: podman build + Dockerfile

The workspace image is defined in `images/workspace/Dockerfile`. Built with:

```bash
podman build -t rockpool-workspace:latest images/workspace/
```

Makefile target:

```makefile
$(STAMP_DIR)/rockpool-workspace-container: images/workspace/Dockerfile images/scripts/setup.sh | $(STAMP_DIR)
	podman build -t rockpool-workspace:latest images/workspace/
```

### Base Image Contents

Kitchen sink -- workspaces should be productive out of the box:

- code-server (web IDE, container entrypoint)
- git, openssh
- bash
- curl, wget, jq
- Node.js (via fnm)
- python3
- make, build-essential
- vim, tmux, htop

### Container Entrypoint

code-server runs as PID 1 via a custom `entrypoint.sh`. The entrypoint reads an optional workspace folder from `~/.config/code-server/workspace-folder` and passes it as a positional argument to code-server:

```bash
#!/bin/sh
FOLDER_FILE="$HOME/.config/code-server/workspace-folder"
FOLDER=""
if [ -f "$FOLDER_FILE" ]; then
    FOLDER="$(cat "$FOLDER_FILE")"
fi
exec code-server --bind-addr=0.0.0.0:8080 --auth=none $FOLDER
```

This replaces the previous systemd-based code-server startup. Configuration changes are applied via `podman exec` to write config files, followed by `podman restart` to pick them up.

### Environment Variables

The worker configures workspaces by writing files into the container via `podman exec`. Key configuration:

| File | Description |
| ---- | ----------- |
| `~/.config/code-server/config.yaml` | code-server bind address, auth mode, proxy base path |
| `~/.config/code-server/workspace-folder` | Optional folder path for code-server to open on start |

Port forwarding is dynamic -- apps bind to any port they want, then the user registers it via the API. See [EDD 003: Caddy Reverse Proxy](003_Caddy_Reverse_Proxy.md) for how port routes are managed.

### Image Storage: Local Only

Images built locally on each machine via `podman build`. No registry, no distribution infra.

### Workspace Persistence: Podman Named Volumes

Each workspace gets a Podman named volume (`<name>-data`) mounted at `/home/admin`. The volume persists across container stop/start and even `podman rm`. Workspace data survives until explicitly deleted with `podman volume rm`.

### Image Updates: New Workspaces Only

Existing workspaces keep their volume data unchanged. Only new workspaces use the latest base image. Users who want a fresh environment create a new workspace.

## Resolved Questions

- [x] Which base distro? **Debian bookworm-slim** -- broad compatibility, minimal footprint.
- [x] How to build images? **podman build** -- standard Dockerfile, no Packer.
- [x] Local or registry? **Local only** -- build on each machine, no distribution overhead.
- [x] What's in the base image? **Kitchen sink** -- code-server, git, bash, node, python, make, jq, curl.
- [x] How is user state preserved? **Podman named volumes** -- `/home/admin` survives stop/start/rm.
- [x] Image update strategy? **New workspaces only** -- existing workspaces are untouched.
- [x] How does code-server start? **Container entrypoint** -- PID 1, no systemd. Config via `podman exec` + `podman restart`.
