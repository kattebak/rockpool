# RFC: Rockpool-on-Rockpool (Ultimate Dogfood Demo)

| Field        | Value                                                                                                                                                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author       | mvhenten                                                                                                                                                                                                                                                                                                                                                  |
| Status       | Draft                                                                                                                                                                                                                                                                                                                                                     |
| Created      | 2026-02-22                                                                                                                                                                                                                                                                                                                                                |
| Updated      | 2026-02-22                                                                                                                                                                                                                                                                                                                                                |
| Related ADRs | [ADR-003](../ADR/003-typespec-api-first.md), [ADR-010](../ADR/010-react-shadcn-tanstack-spa.md), [ADR-014](../ADR/014-build-tooling-conventions.md), [ADR-015](../ADR/015-two-port-origin-isolation.md)                                                                                                                                                   |
| Related EDDs | [EDD-001](../EDD/001_Architecture_Overview.md), [EDD-002](../EDD/002_MicroVM_Runtime.md), [EDD-003](../EDD/003_Caddy_Reverse_Proxy.md), [EDD-004](../EDD/004_Web_IDE.md), [EDD-005](../EDD/005_Workspace_Image_Pipeline.md), [EDD-006](../EDD/006_Vertical_Slice_MVP.md), [EDD-007](../EDD/007_Data_Model.md), [EDD-008](../EDD/008_Package_Structure.md) |

## Summary

Define the "Rockpool-on-Rockpool" ultimate demo with full purity: a Rockpool workspace runs a Linux host that itself runs a full Rockpool control plane and launches real workspace VMs using a real runtime (Incus). This is true VM-in-VM on Linux, with real routing, real lifecycle, and real isolation, producing a realistic developer environment without stubbing.

## Motivation

- Prove Rockpool can be the primary development environment for Rockpool itself.
- Validate end-to-end developer workflow: edit, test, run, and access the Rockpool UI entirely inside a workspace.
- Exercise the control plane, port forwarding, and dev tooling in a realistic, high-stakes scenario.
- Create a compelling demo: "Rockpool builds Rockpool".

## Assumptions

- The outer Rockpool host runs Linux with KVM support.
- The outer runtime is Incus (Linux) and can pass nested virtualization into the workspace VM.
- The inner Rockpool runs on Alpine Linux inside the workspace VM.
- The demo tolerates higher resource usage and lower density than the production host.
- Speed matters more than breadth: Alpine-first for the nested host image.

## Goals

- A single click from the outer Rockpool UI opens a workspace that runs a full Linux host for the inner Rockpool.
- The inner Rockpool runs its own control plane, Caddy, and Incus-managed workspaces.
- Access the inner Rockpool UI, API, and inner workspaces through the outer Rockpool routing fabric.
- Demonstrate true nested virtualization and realistic dev workflows.
- Keep the developer flow inside the workspace to "git clone" and "run dev".

## Non-Goals

- Multi-user support, external auth providers, or production hardening.
- Replacing the outer control plane with the inner one.
- Shipping a generic production nested virtualization feature (this is a demo track).

## Requirements and Constraints

### Host Requirements (Outer)

- CPU with VT-x/AMD-V and nested virt support.
- Kernel with KVM enabled and nested virt toggles set on the host.
- Incus installed and healthy on the host.
- Sufficient resources for a nested host VM plus at least one inner workspace VM.

### Nested Virtualization Requirements

- Outer host exposes `/dev/kvm` to the inner host VM.
- Inner host VM kernel supports KVM and required modules.
- Incus inside the inner host can create VMs (not just containers).

### Network and Routing Constraints

- Three layers of routing must remain path-based.
- Two-port origin isolation must be preserved inside the inner Rockpool (inner Caddy :8080 and :8081).
- Outer Caddy must forward both inner Caddy ports to the inner host VM via workspace port routes.

### Storage and Image Constraints

- Inner host image includes Incus, Caddy, and Rockpool runtime dependencies.
- Inner host image size is acceptable for local builds or local caching.

## Background and Current State

- The outer Rockpool control plane manages workspaces and routes via Caddy using two-port origin isolation ([EDD-001](../EDD/001_Architecture_Overview.md), [EDD-003](../EDD/003_Caddy_Reverse_Proxy.md)).
- code-server runs inside each workspace VM and supports path-based proxy mounting ([EDD-004](../EDD/004_Web_IDE.md)).
- Dev mode already supports `StubRuntime` and `StubCaddy` for running the stack without real VMs or Caddy ([EDD-006](../EDD/006_Vertical_Slice_MVP.md), [EDD-008](../EDD/008_Package_Structure.md)).
- Port forwarding routes are already supported at `/workspace/{name}/port/{port}/*` ([EDD-003](../EDD/003_Caddy_Reverse_Proxy.md), [EDD-007](../EDD/007_Data_Model.md)).

## Proposal

Run a full Rockpool deployment inside a Rockpool workspace by using a Linux host VM as the inner "root VM" and enabling nested virtualization so Incus can create inner workspace VMs. The inner Rockpool owns its own Caddy, control plane, and Incus network. The outer Rockpool provides the first-level workspace and access routing only.

## User-Visible Flow (What Devs Do)

Inside the nested host workspace VM:

1. `git clone` the Rockpool repo.
2. `npm install`
3. `npm run dev`

All other complexity is hidden in the workspace image, preflight checks, and bootstrapping scripts.

### High-Level Flow

1. Outer Rockpool creates a workspace "rockpool-dev" that is a Linux host VM prepared for nested virt.
2. Inside that VM, the developer runs the full Rockpool stack: Caddy, server, worker, and Incus.
3. The inner Rockpool launches its own workspace VMs using Incus.
4. The outer Rockpool registers port routes to the inner Rockpool control plane and to select inner workspaces.
5. The developer accesses the inner Rockpool UI at a nested route like `/workspace/rockpool-dev/port/8080/app/`.

### Why This Requires Nested Virtualization

- The inner Rockpool must use a real runtime adapter (Incus) to launch real inner workspace VMs.
- The inner Caddy must manage real routes for those inner workspaces.
- The inner control plane must run unmodified, using the same code paths as production.

## Detailed Design

### Inner Root VM as a Nested Host

The outer Rockpool workspace is not a standard code-server VM. It is a Linux host VM configured with:

- Nested virtualization enabled at the hypervisor level.
- Incus installed and initialized inside the VM.
- A dedicated Caddy instance running inside the VM.
- The Rockpool control plane services (server, worker) running inside the VM.
- An internal bridge or OVN network for inner workspace VMs.

This inner host mirrors the production root VM topology described in [EDD-001](../EDD/001_Architecture_Overview.md).

### Inner Host Image

The nested host image must include (Alpine-first):

- Alpine Linux base suitable for Incus and Caddy.
- KVM modules installed and configured for VM creation inside the inner host.
- Incus CLI and daemon, plus a default VM profile.
- Caddy installed and configured for dynamic admin API.
- Node.js 22+ and all Rockpool build dependencies.
- A boot-time script that initializes Incus networking and starts the inner control plane.

The image should be a separate workspace template (for example `rockpool-nested-host`) with higher defaults for CPU, RAM, and disk.

Alpine is the first target for the nested host image because speed matters. If Alpine proves incompatible with inner VM tooling, switch to a minimal Debian base as a fallback.

### Alpine Packages and Services

Required `apk` packages for the nested host image:

- `incus`
- `incus-openrc`
- `qemu-system-x86_64`
- `qemu-img`
- `caddy`
- `nodejs`
- `npm`
- `git`
- `openssh-client`
- `bash`
- `curl`
- `jq`

Required OpenRC services to enable at boot:

```bash
rc-update add incus default
rc-update add caddy default
```

Incus initialization (example, non-interactive):

```bash
incus admin init --auto
```

### Alpine Nested Host Setup Sketch

Minimal provisioning sketch for the nested host image:

```bash
#!/usr/bin/env bash
set -euo pipefail

apk update
apk add \
  incus \
  incus-openrc \
  qemu-system-x86_64 \
  qemu-img \
  caddy \
  nodejs \
  npm \
  git \
  openssh-client \
  bash \
  curl \
  jq

rc-update add incus default
rc-update add caddy default

incus admin init --auto
```

### Why This Is Extra Hard (But Possible)

This is not "docker-in-docker"; it is VM-in-VM with real networking and a real control plane. The complexity comes from:

- **Nested KVM is not guaranteed**: the outer host must allow nested virt and explicitly expose `/dev/kvm` to the inner VM.
- **VM runtimes need kernel support**: Incus inside the inner VM needs KVM modules and the right permissions.
- **Double NAT and routing**: inner workspace VMs sit behind the inner host, which itself sits behind the outer host.
- **Two layers of origin isolation**: the inner Caddy must preserve the `:8080` / `:8081` split, and the outer Caddy must forward both.
- **Resource amplification**: each layer consumes CPU and RAM, so defaults must be higher.

It is possible, but only when the host, kernel, and runtime are all aligned for nested virtualization.

### Runtime Choices

- **Outer runtime:** Incus on Linux host.
- **Inner runtime:** Incus inside the inner host VM.
- **Nested virt requirement:** KVM nested virtualization enabled on the outer host and exposed to the inner VM.

### Network and Routing

The nested environment introduces three layers:

1. Outer host and outer Caddy (control plane)
2. Inner host VM (inner Rockpool root VM)
3. Inner workspace VMs (created by inner Incus)

Outer Caddy routes to inner Rockpool ports via the outer workspace port forwarding routes. Inner Caddy routes to inner workspace VMs.

The inner Incus network must use a non-overlapping CIDR to avoid conflicts with the outer Incus bridge. The inner host must NAT inner VM egress and prevent access to the outer host LAN.

### Port Map

Outer routes (examples):

- `/workspace/rockpool-dev/port/8080/` -> inner Caddy srv0 (inner API + SPA)
- `/workspace/rockpool-dev/port/8081/` -> inner Caddy srv1 (inner workspaces)

Inner routes:

- `/app/*` and `/api/*` -> inner control plane
- `/workspace/{name}/*` -> inner workspace VMs

This preserves the two-port origin isolation inside the inner Rockpool while still being reachable from the outer workspace.

### Developer UX

1. Create the "rockpool-dev" workspace from a special "nested host" image.
2. Open the IDE and run the inner Rockpool services (Caddy + server + worker + client build/dev server).
3. Register outer ports 8080 and 8081 for the inner Caddy.
4. Access the inner Rockpool UI via `/workspace/rockpool-dev/port/8080/app/`.
5. Create an inner workspace from the inner UI and open it via `/workspace/rockpool-dev/port/8081/workspace/<inner-name>/`.

## Implementation Plan

### Phase 1: Preflight and Image Build

- Add a Linux-only preflight script to validate nested KVM capability.
- Build a nested host image with Incus and Caddy preinstalled on Alpine.
- Add a workspace template entry for the nested host image.

### Phase 2: Inner Control Plane Bootstrap

- Add scripts to initialize inner Incus network and default profiles.
- Add scripts to start inner Caddy and Rockpool services.
- Ensure inner Caddy is bootstrapped with the same two-port isolation config.

### Phase 3: Outer Routing Integration

- Add helper scripts to register outer workspace ports 8080 and 8081 for the nested host workspace.
- Document the nested URLs and a simple smoke test flow.

### Phase 4: Demo Hardening

- Add a visible "Inner Rockpool" banner in the inner UI.
- Add a health endpoint check and basic logs collection for the inner host.

### System Diagram

```
Browser
  │
  │  /app/* and /api/* (outer)
  ▼
Outer Rockpool (root VM)
  │
  │  /workspace/rockpool-dev/*
  ▼
Inner Root VM (Linux host VM)
  │
  ├── Inner Caddy :8080 (API + SPA)
  ├── Inner Caddy :8081 (workspaces)
  ├── Inner Rockpool server + worker
  └── Inner Incus -> Inner Workspace VMs

Outer Caddy
  ├── /workspace/rockpool-dev/ -> inner code-server IDE
  ├── /workspace/rockpool-dev/port/8080/ -> inner Caddy srv0
  └── /workspace/rockpool-dev/port/8081/ -> inner Caddy srv1
```

## Required Changes to Current Project

1. **Add a nested host image build** for the "inner root VM" with Incus, Caddy, and Rockpool runtime deps preinstalled.
2. **Add a runtime profile** for the outer workspace type to request nested virt and higher resources (CPU, RAM, disk).
3. **Add scripts for inner bootstrap** (install, init Incus, start inner Caddy and control plane).
4. **Update docs** with the nested demo flow, including the outer port registrations for inner Caddy.
5. **Add validation checks** for nested virt availability and KVM passthrough on Linux.

## Validation Checklist

- Outer host reports nested KVM enabled.
- Inner host can start a VM using Incus.
- Inner Caddy bootstraps and serves `/app/` and `/api/`.
- Outer Caddy routes `/workspace/rockpool-dev/port/8080/` to inner Caddy srv0.
- Outer Caddy routes `/workspace/rockpool-dev/port/8081/` to inner Caddy srv1.
- Inner workspace VM can be created and reached via the nested route.

## Feasibility and Technical Constraints

This is feasible, but only under specific host and kernel conditions. If those are not met, the nested demo cannot run.

Hard constraints:

- Linux host with nested KVM enabled.
- Incus must support VM creation on the outer host and inside the inner host.
- The outer host must expose `/dev/kvm` to the inner host VM.
- Networking must allow inner VM NAT egress and non-overlapping CIDRs.

Common blockers:

- Cloud or laptop Linux builds that do not allow nested virtualization.
- Kernel configs that disable KVM nesting or omit required modules.
- Incus installs configured for containers only.

If any hard constraint is missing, the true "Rockpool-on-Rockpool" demo is not feasible on that machine.

## Feasibility Checklist (Preflight)

Run these checks on the outer Linux host before attempting the nested demo.

1. Verify hardware virtualization is available:

```bash
grep -E "(vmx|svm)" /proc/cpuinfo | head -n 1
```

2. Verify KVM modules are loaded and nested is enabled:

```bash
lsmod | grep kvm || true
cat /sys/module/kvm_intel/parameters/nested 2>/dev/null || true
cat /sys/module/kvm_amd/parameters/nested 2>/dev/null || true
```

Expected: `Y` or `1` for the nested parameter on the active module.

3. Verify Incus can create a VM on the outer host:

```bash
incus info
incus profile show default
```

4. Verify the outer host can pass `/dev/kvm` into a VM (manual step):

- Create a test VM profile that exposes `/dev/kvm` to the guest.
- Boot a minimal Linux VM and confirm `/dev/kvm` exists inside the guest.

5. Verify inner Incus can create a VM (inside the nested host):

```bash
incus info
incus launch images:debian/12 test-vm --vm
```

If any step fails, stop and fix the host before proceeding with the demo.

## Security Considerations

- The inner Rockpool should preserve the two-port origin isolation inside the inner host.
- Outer and inner control planes remain distinct origins, but both are reachable from the same browser session. Clear UI labeling is required.
- Nested virtualization expands the attack surface; the inner host must be treated as untrusted user code.

## Risks and Mitigations

| Risk                                                | Impact | Mitigation                                                                              |
| --------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| Nested virtualization unavailable on target host    | High   | Require Linux hosts with nested KVM enabled; provide a preflight check and clear error. |
| Inner Incus networking conflicts with outer network | Medium | Use a dedicated bridge and non-overlapping CIDR for inner Incus.                        |
| Confusion between outer and inner UI                | Medium | Add a visible "Inner Rockpool" banner in the inner UI.                                  |
| Heavy resource use in a single workspace            | Medium | Recommend 4 CPU / 8 GB minimum for the nested host image.                               |

## Operational Notes

- Expect slower boot times and higher memory usage for inner VM creation.
- Keep the inner host image and inner workspace images separate.
- Avoid path collisions by treating the inner Rockpool as a fully separate instance.

## Rollout Plan

1. Build a Linux-only nested host image with Incus and Caddy preinstalled.
2. Add a preflight check for nested KVM on Linux and fail fast if unavailable.
3. Document the demo flow and add a script that registers inner Caddy ports.
4. Validate the full nested flow end-to-end on Linux.

## Open Questions

- Do we want a dedicated "nested host" workspace template with higher resource defaults?
- Should the inner Rockpool expose a custom base path to avoid double `/workspace/.../port/.../` layering?
- How should we surface inner Incus state and logs from the outer UI?
