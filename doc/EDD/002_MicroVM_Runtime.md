# EDD: Workspace Runtime Selection

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Accepted   |
| Created | 2026-02-21 |
| Updated | 2026-03-03 |

## Summary

Evaluation of workspace runtimes for hosting isolated Rockpool workspaces. The runtime must provide programmatic lifecycle control, support running a full Linux userspace with a web IDE, and integrate with path-based routing via Caddy.

**Current decision: Podman rootless containers.** Tart and Firecracker runtimes were evaluated and implemented but have been removed from the codebase. Podman is the only workspace runtime.

## Requirements

| Requirement          | Priority | Notes                                     |
| -------------------- | -------- | ----------------------------------------- |
| Linux support        | Must     | Primary development and deployment target |
| macOS support        | Should   | Via Root VM (Tart/QEMU) running Podman    |
| Network isolation    | Must     | NAT egress only, no LAN access            |
| Programmatic control | Must     | CLI for lifecycle management              |
| Lightweight Linux    | Must     | Slim custom image with code-server        |
| Fast boot            | Should   | Sub-30s acceptable, sub-5s ideal          |
| Low memory overhead  | Should   | Multiple workspaces on a single host      |
| Custom images        | Must     | Dockerfile-based workspace images         |

## Options Evaluated

The original evaluation considered Firecracker, Cloud Hypervisor, Lima, Incus, Tart, QEMU microvm, Kata Containers, and OrbStack. See git history for the full comparison matrix.

### What changed

The project went through several runtime iterations:

1. **Tart (macOS)** -- implemented first for the macOS vertical slice. Used Apple Virtualization Framework for full VM-based workspaces. Removed after EDD-022 moved workspaces to Podman containers.
2. **Firecracker (Linux)** -- implemented in EDD-019 for Linux microVM support. Removed because nested virtualization inside the Root VM carried unacceptable I/O penalties (~40-80% for random disk I/O).
3. **Podman rootless (current)** -- selected in EDD-022. Workspaces run as rootless containers with user namespace isolation, seccomp, and cgroup limits. No nested virtualization overhead.

## Decision

**Selected: Podman rootless containers.**

Podman provides the right balance of isolation, performance, and simplicity for a single-user cloud IDE:

| Aspect    | Assessment                                                |
| --------- | --------------------------------------------------------- |
| macOS     | Via Root VM (Tart boots a Linux VM, Podman runs inside)  |
| Linux     | Native, first-class. Rootless, no daemon.                |
| Boot time | ~1-2s (container start)                                  |
| API       | `podman` CLI, OCI-compatible                             |
| Network   | User namespace isolation, `-P` port publishing           |
| IDE       | Easy -- Dockerfile-based, code-server as entrypoint      |
| Maturity  | Production-grade, RHEL default container runtime         |

### Why Podman over VMs?

- **No nested virtualization penalty.** When running inside a Root VM (macOS), Podman containers avoid the ~40-80% I/O overhead of running VMs inside VMs.
- **Fast lifecycle.** Container create/start/stop is sub-second, vs. 3-30s for VM boot.
- **Dockerfile images.** Standard OCI images built with `podman build`, no Packer or custom rootfs tooling.
- **Rootless by default.** No root daemon, user namespace isolation, seccomp filtering.

### Isolation model

Podman rootless containers provide multiple isolation layers:

| Layer | What it does |
|-------|-------------|
| User namespaces | Container root maps to unprivileged UID on the host |
| Seccomp | Blocks ~40% of syscalls including dangerous ones |
| Cgroups | CPU, memory, I/O limits per container |
| Filesystem | Overlay filesystem, separate rootfs per container |
| Network | Separate network namespace per container |

The one gap vs. a VM: containers share the host kernel. For a single-user system running your own code, this is an acceptable tradeoff. If multi-user untrusted workspaces are needed later, Podman can be swapped for `podman --runtime=kata` without changing the `RuntimeRepository` interface.

### Architecture

```
┌──────────────────────────────────┐
│        RuntimeRepository         │
│   (runtime-agnostic interface)   │
├──────────────────────────────────┤
│  PodmanRuntime                   │
│  podman CLI via execFile()       │
│  podman exec for configuration   │
└──────────────────────────────────┘
```

The `RuntimeRepository` interface provides: `create`, `start`, `stop`, `remove`, `status`, `getIp`, and optionally `configure`, `clone`, `readFile`, `writeFile`.

Key implementation details:

- **No SSH.** All in-container operations use `podman exec`. The SSH-based approach from the Tart era was removed.
- **Port mapping, not bridge IPs.** Rootless Podman bridge IPs (10.88.0.x) are unreachable from outside the container's user namespace. Containers are created with `-P` (publish all), and `getIp()` returns `host:mapped-port` from `podman port`.
- **Configure restarts the container.** code-server runs as PID 1 (container entrypoint). Configuration changes are written via `podman exec`, then `podman restart` applies them. Port mappings change on restart, so `getIp()` must be called after `configure()`.

See: [EDD 005: Workspace Image Pipeline](005_Workspace_Image_Pipeline.md) for the workspace Dockerfile.

## Resolved Questions

- [x] Which platform first? **Linux-first** -- Podman is native on Linux. macOS uses a Root VM.
- [x] Is sub-second boot time needed? **No** -- container start is already sub-second.
- [x] Single runtime or per-platform? **Single runtime** -- Podman everywhere. Root VM provides the Linux environment on macOS.
- [x] Custom images? **Dockerfile** -- standard OCI images, built with `podman build`.
- [x] How much abstraction? **Thin wrapper** -- `RuntimeRepository` interface, single implementation.
- [x] VM-level isolation? **Deferred** -- Podman rootless is sufficient for single-user. Kata Containers is the upgrade path.
