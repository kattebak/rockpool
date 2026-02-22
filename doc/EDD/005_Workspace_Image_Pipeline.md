# EDD: Workspace Image Pipeline

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Accepted   |
| Created | 2026-02-21 |
| Updated | 2026-02-22 |

## Summary

Defines how Rockpool builds, stores, and distributes custom lightweight Linux VM images for workspaces. The current pipeline targets Tart (macOS, OCI images). Incus support is deferred. The build pipeline uses Packer with platform-specific builders. Container tooling (if needed) uses Podman/Buildah, not Docker.

## Prerequisites

- [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md) -- Tart (macOS) selected; Incus deferred
- [EDD 004: Web IDE](004_Web_IDE.md) -- code-server selected as the IDE

## Image Requirements

| Requirement                  | Priority | Notes                                             |
| ---------------------------- | -------- | ------------------------------------------------- |
| Lightweight base             | Must     | Debian minimal (systemd, code-server compatible)  |
| code-server pre-installed    | Must     | Ready to serve IDE on boot                        |
| No Docker dependency         | Must     | Use Podman/Buildah if container tooling is needed |
| Tart-compatible output (OCI) | Must     | For macOS dev environments                        |
| Incus-compatible output      | Later    | For Linux production (deferred)                   |
| Single base image to start   | Must     | Add more image variants later                     |
| Cloneable workspaces         | Should   | Clone via runtime-native snapshots                |
| Reproducible builds          | Should   | Same input produces same image                    |

## Decision

### Base Distro: Debian minimal

Debian minimal provides systemd and broad binary compatibility. The previous Alpine plan was dropped after registry access issues and musl compatibility risks. This is now the default base.

### Build Tool: Packer + Shared Provisioning Script

Single provisioning script (`setup.sh`) for the Debian base, Packer builds platform-specific outputs:

```
setup.sh (shared provisioning script)
        |
   ┌────┴────┐
   |  Packer |
   ├─────────┤
   | Tart    | → OCI image (macOS)
   | builder |
   ├─────────┤
        | QEMU    | → qcow2 (Linux support deferred)
        | builder |
   └─────────┘
```

### Base Image Contents

Kitchen sink -- workspaces should be productive out of the box:

- code-server
- git, openssh
- bash
- curl, wget, jq
- node, python
- make, build tools

### Environment Variables

The worker sets these env vars at VM creation/start. The base image's init scripts consume them:

| Variable                  | Description                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ROCKPOOL_WORKSPACE_NAME` | Workspace slug. code-server's OpenRC service uses this for `--abs-proxy-base-path /workspace/${ROCKPOOL_WORKSPACE_NAME}`. |

Port forwarding is dynamic -- apps bind to any port they want, then the user registers it via the API. No port-related env vars are needed in the image. See [EDD 003: Caddy Reverse Proxy](003_Caddy_Reverse_Proxy.md) for how port routes are managed.

### Image Storage: Local Only

Images built locally on each machine via Packer. No registry, no distribution infra. M4 is fast enough to build locally as part of setup.

### Workspace Persistence: Persistent Disk

VM disk is preserved on stop, reused on start. Everything the user installed or changed survives restarts. Future option to mount separate volumes for user data or shared tooling (e.g. nix store).

### Workspace Cloning: Runtime-Native Snapshots

Tart supports disk snapshots natively. Incus snapshots remain planned for the deferred Linux runtime.

### Image Updates: New Workspaces Only

Existing workspaces keep their disk unchanged. Only new workspaces use the latest base image. Users who want a fresh environment create a new workspace.

## Resolved Questions

- [x] Which base distro? **Debian minimal** -- systemd + compatibility, avoids Alpine registry and musl issues.
- [x] How to build for both runtimes? **Packer** -- shared provisioning script, per-platform builders.
- [x] Local or registry? **Local only** -- build on each machine, no distribution overhead.
- [x] What's in the base image? **Kitchen sink** -- code-server, git, bash, node, python, make, jq, curl.
- [x] How does cloning work? **Runtime-native snapshots** -- Tart now; Incus later.
- [x] How is user state preserved? **Persistent disk** -- VM disk survives stop/start cycles.
- [x] Image update strategy? **New workspaces only** -- existing workspaces are untouched.
