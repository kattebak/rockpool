# EDD: Workspace Image Pipeline

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Accepted   |
| Created | 2026-02-21 |
| Updated | 2026-02-21 |

## Summary

Defines how Tidepool builds, stores, and distributes custom lightweight Linux VM images for workspaces. Images must work across two runtimes: Tart (macOS, OCI images) and Incus (Linux, its own image format). The build pipeline uses Packer with platform-specific builders. Container tooling (if needed) uses Podman/Buildah, not Docker.

## Prerequisites

- [EDD 002: MicroVM Runtime](002_MicroVM_Runtime.md) -- Tart (macOS) + Incus (Linux) selected
- [EDD 004: Web IDE](004_Web_IDE.md) -- code-server selected as the IDE

## Image Requirements

| Requirement | Priority | Notes |
|---|---|---|
| Lightweight base | Must | Alpine Linux (two-way door, can switch to Debian if musl issues) |
| code-server pre-installed | Must | Ready to serve IDE on boot |
| No Docker dependency | Must | Use Podman/Buildah if container tooling is needed |
| Tart-compatible output (OCI) | Must | For macOS dev environments |
| Incus-compatible output | Must | For Linux production |
| Single base image to start | Must | Add more image variants later |
| Cloneable workspaces | Should | Clone via runtime-native snapshots |
| Reproducible builds | Should | Same input produces same image |

## Decision

### Base Distro: Alpine Linux

Smallest base (~5MB), fast builds. musl libc may cause compatibility issues with some native binaries -- if this becomes a problem, switch to Debian minimal. Two-way door decision.

### Build Tool: Packer + Shared Provisioning Script

Single `alpine-setup.sh` provisioning script, Packer builds platform-specific outputs:

```
alpine-setup.sh (shared provisioning script)
        |
   ┌────┴────┐
   |  Packer |
   ├─────────┤
   | Tart    | → OCI image (macOS)
   | builder |
   ├─────────┤
   | QEMU    | → qcow2 → import to Incus (Linux)
   | builder |
   └─────────┘
```

### Base Image Contents

Kitchen sink -- workspaces should be productive out of the box:

- code-server
- git, openssh
- bash (Alpine ships ash)
- curl, wget, jq
- node, python
- make, build tools

### Image Storage: Local Only

Images built locally on each machine via Packer. No registry, no distribution infra. M4 is fast enough to build locally as part of setup.

### Workspace Persistence: Persistent Disk

VM disk is preserved on stop, reused on start. Everything the user installed or changed survives restarts. Future option to mount separate volumes for user data or shared tooling (e.g. nix store).

### Workspace Cloning: Runtime-Native Snapshots

Both Tart and Incus support disk snapshots natively. Clone operation snapshots the source VM's disk and creates a new VM from it. Exposed through the adapter interface.

### Image Updates: New Workspaces Only

Existing workspaces keep their disk unchanged. Only new workspaces use the latest base image. Users who want a fresh environment create a new workspace.

## Resolved Questions

- [x] Which base distro? **Alpine Linux** -- smallest base, switch to Debian if musl bites.
- [x] How to build for both runtimes? **Packer** -- shared provisioning script, per-platform builders.
- [x] Local or registry? **Local only** -- build on each machine, no distribution overhead.
- [x] What's in the base image? **Kitchen sink** -- code-server, git, bash, node, python, make, jq, curl.
- [x] How does cloning work? **Runtime-native snapshots** -- both Tart and Incus support this.
- [x] How is user state preserved? **Persistent disk** -- VM disk survives stop/start cycles.
- [x] Image update strategy? **New workspaces only** -- existing workspaces are untouched.
