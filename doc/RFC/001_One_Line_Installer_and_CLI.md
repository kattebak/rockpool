# RFC: One-Line Installer and Rockpool CLI

| Field        | Value                                                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author       | mvhenten                                                                                                                                                                                                                           |
| Status       | Draft                                                                                                                                                                                                                              |
| Created      | 2026-02-22                                                                                                                                                                                                                         |
| Updated      | 2026-02-22                                                                                                                                                                                                                         |
| Related ADRs | [ADR-005](../ADR/005-node22-esmodules.md), [ADR-007](../ADR/007-npm-workspaces-monorepo.md), [ADR-014](../ADR/014-build-tooling-conventions.md), [ADR-015](../ADR/015-two-port-origin-isolation.md)                                |
| Related EDDs | [EDD-002](../EDD/002_MicroVM_Runtime.md), [EDD-003](../EDD/003_Caddy_Reverse_Proxy.md), [EDD-005](../EDD/005_Workspace_Image_Pipeline.md), [EDD-008](../EDD/008_Package_Structure.md) |

## Summary

Design a delightful, low-friction installation path for Rockpool using a one-line installer (`curl -fsSL https://.../install.sh | bash`) that bootstraps a small, portable CLI. The CLI handles installation, upgrades, diagnostics, and lifecycle management across macOS (Tart) and Linux (Incus). The experience must be safe, predictable, and easy to verify with a smoke test. The installer aligns with the architecture where the control plane runs inside the root VM.

## Motivation

Rockpool is currently developer-focused. The next step is a minimal-fuss install that works on a mac mini, laptop, or Linux NAS. A one-line installer is the standard pattern for infrastructure products and helps remove setup friction for evaluation and early adopters.

## Goals

- One-line install path that is predictable, auditable, and safe by default.
- A single CLI that handles install, update, uninstall, and diagnostics.
- Cross-platform support: macOS (Tart) and Linux (Incus).
- Root VM control plane distribution with reproducible releases.
- A smoke test that verifies a full end-to-end route to a workspace.

## Non-Goals

- Windows support (can be added later).
- A fully hosted SaaS onboarding flow.
- Advanced multi-tenant auth flows (basic auth is fine for now).
- Automatic network exposure on the public internet (no implicit TLS or DNS setup).

## Background and Current State

- The current flow uses `npm-scripts/` to start a VM, configure code-server, bootstrap Caddy, and add routes.
- macOS uses Tart for microVMs ([EDD-002](../EDD/002_MicroVM_Runtime.md)).
- Linux uses Incus for microVMs ([EDD-002](../EDD/002_MicroVM_Runtime.md)).
- Images are built locally with Packer, shared provision script, and produce Tart and Incus outputs ([EDD-005](../EDD/005_Workspace_Image_Pipeline.md)).

## Proposal Overview

### Two-Stage Installer

1. **Bootstrap script** (bash): downloads a platform-specific Rockpool CLI binary, validates checksums, and installs it into a user-writable prefix.
2. **CLI** (`rockpool`): performs system checks, installs required dependencies, builds or downloads VM images, configures services, and runs verification.

This mirrors common tooling patterns such as k3s, tailscale, and rustup, while remaining auditable and easy to mirror for offline installs.

### CLI Language and Packaging

**Recommended:** Go (static single binary, fast startup, easy cross-compile). Zig is viable but less mature for CLI tooling ecosystems. Node is not suitable as a bootstrap dependency because it is often not preinstalled.

**Artifacts:**

- `rockpool_darwin_arm64`
- `rockpool_darwin_x64`
- `rockpool_linux_arm64`
- `rockpool_linux_x64`
- `checksums.txt` and `checksums.txt.sig`

### Root VM Hosts the Control Plane

The control plane and Caddy run inside a root VM as described in the architecture overview. The CLI provisions and manages the root VM as a first-class component, so the host does not need container tooling.

**Rationale:**

- Matches the system topology in the architecture overview.
- Keeps host dependencies minimal without requiring a container runtime.
- Preserves the two-port origin isolation scheme at the VM boundary.

### Runtime Integration

- **macOS:** Tart is required. The CLI installs Tart via Homebrew or validates an existing install.
- **Linux:** Incus is required. The CLI installs Incus via system package manager or guides the user to the official install.

## Detailed Design

### Bootstrap Script (`install.sh`)

Responsibilities:

- Detect OS and architecture.
- Validate prerequisites for the bootstrap step (curl, tar, shasum/sha256sum).
- Download the correct CLI binary and checksum file.
- Verify checksum and optional signature.
- Install into `$HOME/.rockpool/bin` by default, or `/usr/local/bin` when running with sudo.
- Print next steps (`rockpool install`).

Security posture:

- Always use HTTPS.
- Validate checksums.
- Support optional GPG or Sigstore signatures in a follow-up iteration.
- Avoid executing remote code beyond the bootstrap script.

### CLI Commands

Core commands:

- `rockpool install` - runs preflight checks, installs runtime deps, pulls images, configures services.
- `rockpool up` - starts control plane and ensures Caddy routes are ready.
- `rockpool down` - stops services.
- `rockpool status` - high-level system status.
- `rockpool doctor` - deep diagnostics with actionable output.
- `rockpool smoke-test` - end-to-end verification.
- `rockpool logs` - show recent logs for control plane and Caddy.
- `rockpool update` - upgrade CLI and VM images.
- `rockpool uninstall` - remove services and optionally data.

### Preflight Checks

Checks should fail fast with clear remediation steps:

**Platform:**

- OS is `darwin` or `linux`.
- CPU arch is `arm64` or `x64`.

**Virtualization:**

- macOS: Apple Virtualization Framework availability.
- Linux: KVM available (`/dev/kvm` exists, user permissions OK).

**Runtime dependencies:**

- macOS: Tart installed and functional.
- Linux: Incus installed and functional.
- Root VM image tooling available (see image section).

**System resources:**

- Free disk space (min 10GB).
- Memory (min 8GB, warn below 16GB).
- Required ports are free: 8080, 8081, 2019 (optional), 7163 (control plane if not proxied).

### Images and Assets

- **Root VM image**: prebuilt image that embeds Caddy + control plane services.
- **Workspace base image**: platform-specific for Tart/Incus.
- **Distribution**: local-only by default (aligned with the workspace image pipeline). Optionally support prebuilt downloads as a future enhancement.
- **Cache location**:
  - macOS: `~/Library/Application Support/Rockpool`
  - Linux: `/var/lib/rockpool`

### Service Management

- **macOS:** launchd plist created by the CLI to run the root VM lifecycle on boot.
- **Linux:** systemd unit to run the root VM lifecycle on boot.

Services should run as a dedicated system user (for example `rockpool`) where available.

### Diagnostics and Insights

`rockpool doctor` should collect:

- Version information (CLI, control plane image, runtime).
- Runtime health (Tart/Incus status, image availability).
- Caddy config routes and expected ports.
- Workspace service health endpoint (`/api/healthz`).
- Connectivity checks to a workspace route and to a port-forward route.
- Common failure hints (port in use, missing permissions, failed VM IP lookup).

`rockpool status` should provide:

- Services running/stopped.
- Number of workspaces, running/stopped.
- Base image status and last update time.

### Smoke Test

`rockpool smoke-test` should:

1. Create a temporary workspace `smoke-<timestamp>`.
2. Wait for root VM readiness and Caddy route provisioning.
3. Verify `http://localhost:8080/api/healthz` returns 200.
4. Verify `http://localhost:8081/workspace/smoke-.../` returns 200 or redirect.
5. Verify `http://<workspace_vm_ip>:8080/healthz` returns 200 from code-server.
6. Remove the workspace.

On failure, the CLI prints the failing step and suggests next actions (`rockpool doctor`, `rockpool logs`).

## UX and Command Flow Examples

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/rockpool/cli/v0.40.4/install.sh | bash

# Then

rockpool install
```

### Start and Verify

```bash
rockpool up

rockpool smoke-test
```

### Diagnostics

```bash
rockpool doctor
```

## Security Considerations

- Checksums are mandatory for all CLI downloads.
- Releases should include signed checksums (GPG or Sigstore) for tamper resistance.
- The bootstrap script should not require root unless the user wants a global install.
- No sensitive data should be logged by default.

## Alternatives Considered

### Pure Bash Installer

- **Pros:** Simple, no build pipeline.
- **Cons:** Hard to maintain for complex logic, error handling, and diagnostics.

### Node-Based CLI

- **Pros:** Matches current stack.
- **Cons:** Requires Node pre-install, heavier bootstrap, less suited for one-line install.

### Zig CLI

- **Pros:** Small static binaries, modern tooling.
- **Cons:** Smaller ecosystem and fewer stable libraries for OS-specific tasks.

## Rollout Plan

1. Implement bootstrap script and publish CLI binaries in `rockpool/cli` release flow.
2. Add `rockpool install` for macOS (Tart) and Linux (Incus) with preflight checks.
3. Package the root VM image and basic `rockpool up` flow.
4. Add `doctor`, `status`, and `smoke-test`.
5. Document the flow in README and a dedicated install page.

## Open Questions

- Do we want to distribute prebuilt VM images, or keep local Packer builds for now?
- Which defaults should apply for data directory and service user?
- How aggressively should the Linux installer attempt package manager installs vs. guided setup?

## Appendix: Mapping to Current MVP Scripts

The CLI should initially wrap the existing MVP scripts where possible:

- `rockpool install` can run the equivalent of `mvp:build-image` for the workspace image and a new root VM image build step.
- `rockpool up` can wrap root VM startup plus workspace setup steps.
- `rockpool smoke-test` aligns with `mvp:verify` and extends it with root VM control plane checks.

## Host Dependency Strategy

### macOS (Developer Machines)

- Accept Homebrew as a dependency.
- CLI can install Tart and any lightweight tooling via brew.

### Linux (NAS/Desktop Server)

- Target the big three families: Alpine (`apk`), Debian-like (`apt`), and Fedora-like (`dnf`).
- Prefer system package managers and official Incus installation paths.
- Hint: detect the family via `/etc/os-release` (`ID`, `ID_LIKE`) and fall back to probing for `apk`, `apt-get`, or `dnf` in `PATH`.
- Hint: print the exact command it will run before executing it, and ask for confirmation when root is required.
- If no supported manager is available, print guided steps with distro-specific commands.
- Avoid pulling in container runtimes; the root VM hosts the control plane.

#### Alpine (apk)

- Install Incus via `apk add incus` if available in the enabled repositories.
- If Incus is not packaged for the target release, print a guided path to the official Incus install docs.

#### Debian-like (apt)

- Use `apt update` then `apt install incus` when available in the distro repository.
- If the distro package is missing or too old, guide the user to the official Incus repository setup for their distro.

#### Fedora-like (dnf)

- Use `dnf install incus` when available in the distro repository.
- If missing, guide the user to the official Incus packaging instructions for Fedora/RHEL-like systems.
