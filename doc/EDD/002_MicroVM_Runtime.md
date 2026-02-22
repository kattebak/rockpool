# EDD: MicroVM Runtime Selection

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Accepted   |
| Created | 2026-02-21 |
| Updated | 2026-02-22 |

## Summary

Evaluation of microVM and lightweight VM runtimes for hosting isolated Tidepool workspaces. The runtime must support macOS (laptop dev) and Linux (server), provide strong network isolation, and allow running a full Linux userspace with a web IDE.

## Requirements

| Requirement          | Priority | Notes                                     |
| -------------------- | -------- | ----------------------------------------- |
| macOS support        | Must     | Dev on Apple Silicon laptop               |
| Linux support        | Should   | Production on office server (later phase) |
| Network isolation    | Must     | No LAN access, NAT egress only            |
| Programmatic control | Must     | API or scriptable CLI for lifecycle mgmt  |
| Lightweight Linux    | Must     | Slim custom image with code-server        |
| Fast boot            | Should   | Sub-30s acceptable, sub-5s ideal          |
| Low memory overhead  | Should   | Multiple workspaces on a single host      |
| Custom images        | Must     | Lightweight custom-built VM images        |

## Options Evaluated

### Firecracker

AWS-developed microVM monitor. Powers Lambda and Fargate.

| Aspect    | Assessment                                                       |
| --------- | ---------------------------------------------------------------- |
| macOS     | Only via nested KVM in a Linux VM (requires M3+ for nested virt) |
| Linux     | Native, first-class. KVM required.                               |
| Boot time | ~125ms                                                           |
| API       | REST API, excellent                                              |
| Network   | TAP devices, isolation by default                                |
| Coder/IDE | Hard -- requires custom rootfs images                            |
| Maturity  | Production-grade (AWS Lambda)                                    |

**Verdict:** Gold standard on Linux. Painful on macOS -- double-nested VM layer. Custom rootfs is significant effort.

### Cloud Hypervisor

Intel-initiated Rust VMM, similar to Firecracker with more features (hotplug, broader device support).

| Aspect    | Assessment                                      |
| --------- | ----------------------------------------------- |
| macOS     | None. Same nested-VM workaround as Firecracker. |
| Linux     | Native, KVM required.                           |
| Boot time | ~100-150ms                                      |
| API       | REST API                                        |
| Network   | TAP devices                                     |
| Maturity  | Production (Intel, Kata Containers)             |

**Verdict:** Similar to Firecracker, more features, same macOS limitation.

### Lima

CNCF Incubating project. Linux VMs on macOS and Linux.

| Aspect    | Assessment                                           |
| --------- | ---------------------------------------------------- |
| macOS     | Native via Apple Virtualization Framework            |
| Linux     | Supported via QEMU                                   |
| Boot time | ~10-30s                                              |
| API       | `limactl` CLI, scriptable, YAML config               |
| Network   | NAT, vzNAT, socket_vmnet, user-v2                    |
| Coder/IDE | Easy -- full distro with systemd, cloud-init support |
| Maturity  | CNCF Incubating, v2.0 (Dec 2025)                     |

**Verdict:** Best cross-platform story. Full Linux VMs, easy provisioning. Slower boot but most ergonomic. Good network isolation via NAT modes.

### Incus (LXD fork)

Community fork of Canonical's LXD. Manages system containers and full VMs. REST API-first.

| Aspect    | Assessment                                                  |
| --------- | ----------------------------------------------------------- |
| macOS     | Client only (remote management via TLS)                     |
| Linux     | Native, first-class. Containers + VMs.                      |
| Boot time | Containers: ~2s. VMs: ~5-15s.                               |
| API       | REST API, excellent. Best-in-class.                         |
| Network   | OVN, bridge ACLs, isolated networks. Best networking story. |
| Coder/IDE | Official Coder template exists                              |
| Maturity  | Very mature (10+ years of LXC/LXD heritage)                 |

**Verdict:** Strongest option for the Linux server. Best networking (OVN), best API, official Coder integration. No local execution on macOS.

### Tart

Cirrus Labs CLI for Apple Virtualization Framework. macOS-native.

| Aspect    | Assessment                                 |
| --------- | ------------------------------------------ |
| macOS     | Native. Apple Virtualization Framework.    |
| Linux     | None.                                      |
| Boot time | Fast, a few seconds.                       |
| API       | `tart` CLI, OCI image support              |
| Network   | NAT default, `--net-softnet` for isolation |
| Coder/IDE | Full ARM64 Linux VMs                       |
| Maturity  | Active, used in CI pipelines               |

**Verdict:** Most native macOS option. OCI images for reproducibility. Cannot run on Linux.

### QEMU microvm

QEMU's lightweight machine type with minimal device emulation.

| Aspect    | Assessment                                                       |
| --------- | ---------------------------------------------------------------- |
| macOS     | QEMU runs on macOS (HVF), but `microvm` machine type is x86-only |
| Linux     | Native. ~10ms kernel boot with KVM.                              |
| Boot time | 10ms (Linux/KVM), 10-30s (macOS/standard)                        |
| API       | QMP (JSON socket), powerful but complex                          |
| Network   | Full control: TAP, SLIRP, bridges                                |
| Maturity  | QEMU is extremely mature                                         |

**Verdict:** Maximum flexibility, minimum opinions. More DIY work required.

### Kata Containers

OCI runtime that runs containers inside lightweight VMs. Requires Kubernetes.

**Verdict:** Overkill -- introduces Kubernetes dependency. No macOS support. Better suited for multi-tenant cloud, not single-host.

### OrbStack

Commercial macOS app for Docker + Linux VMs.

**Verdict:** Great DX but proprietary, macOS-only, network isolation not yet shipped. Not a fit.

## Comparison Matrix

| Option           | macOS   | Linux | Boot   | API     | Net Isolation | IDE Ease | Cross-platform |
| ---------------- | ------- | ----- | ------ | ------- | ------------- | -------- | -------------- |
| Firecracker      | M3+\*   | Yes   | 125ms  | REST    | Excellent     | Hard     | No             |
| Cloud Hypervisor | M3+\*   | Yes   | 150ms  | REST    | Excellent     | Hard     | No             |
| Lima             | Yes     | Yes   | 10-30s | CLI     | Good          | Easy     | Yes            |
| Incus            | Remote  | Yes   | 2-15s  | REST    | Excellent     | Easy     | Partial        |
| Tart             | Yes     | No    | ~3s    | CLI/OCI | Good          | Good     | No             |
| QEMU microvm     | Partial | Yes   | 10ms   | QMP     | Excellent     | Medium   | Partial        |

\*Via nested KVM in a Linux VM

## Recommended Approaches

### Option A: Lima (unified, cross-platform)

Use Lima on both macOS and Linux. Single abstraction, YAML-based VM definitions, cloud-init provisioning. Trade-off: 10-30s boot, not sub-second.

**Pros:** One tool everywhere, CNCF backed, easy Coder/code-server setup, good network isolation.
**Cons:** Slower boot, CLI-based (no REST API), less mature on Linux than macOS.

### Option B: Tart (macOS) + Incus (Linux)

Best-of-breed for each platform. Write a thin abstraction layer that calls `tart` on macOS and Incus REST API on Linux.

**Pros:** Native performance on each platform, best networking on Linux (Incus OVN), OCI images on macOS (Tart).
**Cons:** Two codepaths, abstraction layer to maintain, different image formats.

### Option C: Incus everywhere (server-focused)

Run Incus on the Linux server. Use macOS only as a remote client. All VMs live on the server.

**Pros:** Single runtime, best API, best networking, official Coder template.
**Cons:** Requires network to server, no offline laptop development.

## Decision

**Selected (now): Tart on macOS.**

Incus remains the likely Linux runtime but is explicitly deferred to a later phase. The current implementation targets Tart only to unblock the macOS path and the vertical slice.

| Question          | Decision                 | Rationale                                                                               |
| ----------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| Mac chip          | M4                       | Nested virt available but not needed -- Tart is native                                  |
| Boot time         | Not a differentiator     | All runtimes converge once booting a full userspace                                     |
| Platform strategy | macOS-first              | Dev on laptop (Tart); Linux runtime deferred                                            |
| VM images         | Custom lightweight Linux | Debian minimal, baked with code-server (see [EDD 005](005_Workspace_Image_Pipeline.md)) |
| Abstraction level | Thin wrappers            | Service repository pattern, shared interface per runtime                                |

### Why not Lima?

Lima offers the simplest cross-platform story (one tool everywhere), but:

- No OCI image support -- custom images require building QCOW2s with external tooling
- CLI-only, no REST API
- Less mature on Linux than on macOS

### Why not Firecracker / Cloud Hypervisor?

Gold standard for boot time on Linux, but:

- No macOS support without double-nested VMs
- Custom rootfs image building is significant effort
- Boot time advantage disappears once a full userspace is required

### Architecture (current)

```
┌─────────────────────────────────┐
│        Workspace Service        │
│   (runtime-agnostic interface)  │
├───────────────────────────────┤
│  TartAdapter (macOS)           │
│  CLI wrapper                   │
└───────────────────────────────┘
```

Each adapter implements the same interface: create, start, stop, delete, status, getIp, and optionally configure. The `configure()` method is called after VM boot to set up workspace-specific settings (e.g., code-server base path). It is optional — `StubRuntime` omits it.

See: [EDD 005: Workspace Image Pipeline](005_Workspace_Image_Pipeline.md) for image build and distribution strategy.

## Implementation Notes

### Non-blocking start()

`TartRuntime.start()` uses `spawn()` (detached, unref'd) rather than `execFile()` to launch the VM. Tart's `run` command blocks until the VM shuts down, so a blocking call would hang the worker. The spawned process is detached and unreferenced so it outlives the parent. After spawning, `start()` polls `tart list` until the VM status reaches "running".

### Optional configure()

The `RuntimeRepository` interface marks `configure?()` as optional. When present, the worker calls it after `start()` + `getIp()` to inject workspace-specific configuration into the running VM. For `TartRuntime`, this SSH's into the VM to write code-server's YAML config and restart the service via `systemctl`. SSH is used instead of `tart exec` because the Tart Guest Agent is unreliable on Linux VMs (control socket connection failures). SSH connects as soon as `sshd` starts (~2-3s), with a retry loop for the brief boot window. Requires `sshKeyPath` in runtime options. `StubRuntime` does not implement it.

## Resolved Questions

- [x] Which Mac chip? **M4** -- nested virt available, Tart makes it irrelevant.
- [x] Is 10-30s boot time acceptable? **Yes** -- all runtimes converge for full userspace boot.
- [x] Single platform first or cross-platform? **macOS-first** -- dev on laptop, defer Linux runtime until later.
- [x] Custom VM images or standard distro? **Custom lightweight Linux** -- slim base, baked images.
- [x] How much abstraction? **Thin wrappers** -- service repository pattern, shared interface.
