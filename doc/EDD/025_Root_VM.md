# EDD-025: Root VM

| Field        | Value                                              |
| ------------ | -------------------------------------------------- |
| Author       | mvhenten                                           |
| Status       | Draft                                              |
| Created      | 2026-03-03                                         |
| Related ADRs | [ADR-015](../ADR/015-two-port-origin-isolation.md) |
| Related EDDs | [EDD-001](001_Architecture_Overview.md)            |

## Summary

Run Rockpool inside a minimal Linux VM. The VM is a deployment target — code is pushed in via rsync, config is pushed via scp, services are controlled via SSH. The host runs only the hypervisor and the developer's editor.

## Motivation

**Security boundary.** When the host is internet-facing (NAS, home server behind Cloudflare Tunnel), a container shares the host kernel — a kernel exploit compromises the host and its data. A VM provides hardware-enforced isolation. Everything inside it — control plane and workspaces — is separated from the host by a hypervisor.

**Resource isolation.** The VM caps CPU, memory, and disk consumption. Runaway workspaces or builds can't starve the host.

## Design Principles

- The VM is a deployment target, not a development environment
- Same compose stack runs inside the VM as runs locally
- Code and config are pushed in; state lives on a persistent data disk
- VM image is a stable base OS, rebuilt rarely
- Scripts work on both Linux (QEMU/KVM) and macOS (Tart)

## Architecture

```
┌──────────────────────────────────────┐
│         Host (macOS/Linux)           │
│                                      │
│  Developer's editor                  │
│  Hypervisor (QEMU/KVM or Tart)      │
│                                      │
│  ┌────────────────────────────────┐  │
│  │       Root VM (Linux)          │  │
│  │                                │  │
│  │  /opt/rockpool/    (code)      │  │
│  │  /data/            (state)     │  │
│  │                                │  │
│  │  podman compose up             │  │
│  │    caddy                       │  │
│  │    server                      │  │
│  │    worker                      │  │
│  │    elasticmq                   │  │
│  │    client                      │  │
│  │                                │  │
│  │  ┌────────┐ ┌────────┐        │  │
│  │  │ ws-a   │ │ ws-b   │        │  │
│  │  │ podman │ │ podman │        │  │
│  │  └────────┘ └────────┘        │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

## VM Image

### Contents

- Debian Bookworm minimal (x86_64 for Linux hosts, aarch64 for macOS/Apple Silicon)
- Node.js (via fnm)
- Podman (rootless, from Debian repos)
- Podman compose
- SSH server (Ed25519 keypair, password auth disabled)
- systemd-networkd (DHCP)

The image contains no application code. Rockpool is deployed separately.

### Build: Linux (QEMU/KVM)

Fully rootless pipeline — no sudo needed for building or running:

```
build-root-vm.sh                      ← no sudo
  │
  ├─ mmdebstrap --mode=unshare       ← user namespace, outputs tarball
  │    --customize-hook runs setup script
  │
  ├─ Extract kernel + initrd          ← tar xf from tarball
  │
  ├─ mke2fs -d rootfs.tar            ← populate ext4, no mount needed
  │
  ├─ qemu-img convert -c             ← raw → compressed qcow2
  │
  └─ Output:
       .vm/rockpool-root.qcow2
       .vm/vmlinuz
       .vm/initrd.img
```

Key technologies:

| Tool | What it does | Why rootless |
|------|-------------|-------------|
| `mmdebstrap --mode=unshare` | Builds Debian rootfs | User namespace — appears root, maps to unprivileged user |
| `mke2fs -d` | Writes ext4 from tarball | Writes on-disk structures directly, no kernel mount |
| QEMU direct kernel boot | Boots with `-kernel`/`-initrd` flags | No GRUB, no MBR, no partition table |

### Build: macOS (Tart)

```
build-root-vm-tart.sh
  │
  ├─ tart create --linux rockpool-root   ← aarch64 Debian
  ├─ tart run → SSH in → run setup script
  └─ tart stop
```

### Setup script

`images/root-vm/setup-root-vm.sh` installs Node, podman, podman-compose, and configures SSH + networking. Runs inside the mmdebstrap hook (Linux) or via SSH (macOS). Same script for both platforms.

## Disks

### Root disk

The VM image. Contains the base OS. Rebuilt rarely.

### Data disk

A second disk image, mounted at `/data` inside the VM. Created once, persists across VM rebuilds and code deploys. Formatted as ext4.

| Path | Contents |
|------|----------|
| `/data/rockpool.db` | SQLite database |
| `/data/containers/` | Podman storage root (workspace images + volumes) |
| `/data/logs/` | Workspace logs |

Attachment method:

- QEMU: second `-drive file=.vm/data.qcow2,format=qcow2,if=virtio`
- Tart: `--disk .vm/data.img`

The data disk is what makes both code and VM swappable — rebuild the VM or redeploy code without losing workspace state.

## Control Script

A single script `npm-scripts/root-vm.sh` with subcommands. One npm script wires it in:

```json
{ "vm": "npm-scripts/root-vm.sh" }
```

Usage: `npm run vm -- <command> [args]`

### Commands

| Command | What it does |
|---------|-------------|
| `build` | Build VM image (rare). Platform-detected: mmdebstrap on Linux, Tart on macOS |
| `start` | Boot the VM. Waits for SSH to become available |
| `stop` | Shut down the VM. SSH `sudo poweroff`, fallback to SIGTERM/SIGKILL |
| `deploy` | rsync codebase to `/opt/rockpool/` on the VM, then `npm ci --production` inside |
| `configure <file>` | scp the given env file to `/opt/rockpool/runtime.env` on the VM |
| `up` | SSH → `podman compose up -d` |
| `down` | SSH → `podman compose down` |
| `restart` | SSH → `podman compose restart` |
| `logs` | SSH → `podman compose logs -f` |
| `ssh` | Interactive SSH shell into the VM |

### Deploy

- rsync excludes: `.git/`, `node_modules/`, `.vm/`, `*.env`, build artifacts
- After sync: runs `npm ci --production` inside the VM
- Intentionally a copy, not a live mount — the host codebase can be in a dirty state

### Configure

- Copies the given env file to `/opt/rockpool/runtime.env` on the VM
- `runtime.env` is not tracked in git
- Contains: `DB_PATH=/data/rockpool.db`, `RUNTIME=podman`, ports, etc.
- Can push any env file — run dev, test, or a custom profile inside the VM

### Platform detection

The script detects the platform at the top and delegates to QEMU (Linux) or Tart (macOS) for VM-specific operations (build, start, stop, SSH). Service commands (deploy, configure, up, down, logs) are platform-agnostic — they all go over SSH.

## Network

```
Host :8080 ──► VM :8080 (Caddy)
Host :8081 ──► VM :8081 (Caddy)
Host :8082 ──► VM :8082 (Caddy)
```

- QEMU: user-mode networking with `hostfwd=tcp::8080-:8080,...`
- Tart: softnet with `--net-softnet-expose=8080:8080,...`
- Inside VM: same compose stack, Caddy on standard ports
- Workspace containers: `-P` (publish all) + `podman port` for mapped ports

Port ranges match the env file pushed via `vm:configure`. Push `test.env` and forward 9080-9082 to run the test profile.

## Security Model

```
Host ─── [VM boundary] ─── Root VM ─── [container boundary] ─── Workspace
```

| Layer | What it protects |
|-------|-----------------|
| VM boundary (hypervisor) | Host data from all Rockpool code |
| Container boundary (podman rootless) | Control plane from workspace code |
| User namespaces | Container root → unprivileged UID in VM |
| Seccomp | Blocks ~40% of syscalls |
| Cgroups | CPU, memory, I/O limits per workspace |

Two boundaries between workspace code and host data. A workspace breakout reaches an unprivileged user in the VM, which is still one full VM boundary from the host.

### Upgrade path

If Rockpool supports untrusted multi-user workspaces, podman can be swapped for `podman --runtime=kata` or a VM-based container runtime. The `RuntimeRepository` interface stays the same.

## Dev Workflow

Local development is unchanged:

```bash
npm run start:dev          # local compose, dev profile
npm run stop:dev           # stop dev
npm run start:test         # local compose, test profile
npm run test:e2e:headless  # Playwright E2E
```

VM deployment is additive:

```bash
# One-time
npm run vm -- build

# Boot
npm run vm -- start

# Deploy code + config
npm run vm -- deploy
npm run vm -- configure runtime.env

# Start services
npm run vm -- up

# Iterate: edit locally, then...
npm run vm -- deploy && npm run vm -- restart

# Inspect
npm run vm -- logs
npm run vm -- ssh

# Shut down
npm run vm -- down
npm run vm -- stop
```

## Scope

### In scope

- `npm-scripts/root-vm.sh` — single control script with subcommands
- VM image build (Linux QEMU + macOS Tart)
- Setup script (Node, podman, compose, SSH, networking)
- Data disk creation and fstab mount
- Platform detection (QEMU on Linux, Tart on macOS)

### Out of scope

- CI/CD pipeline (rootless build unblocks it, but not wired yet)
- Production hardening (firewall, TLS, backups, monitoring)
- Cloudflare Tunnel / external ingress
- Multi-user
- Auto-deploy on file change (explicit deploy step is intentional)

## Open Questions

- [ ] **VM resource defaults.** CPU count and RAM allocation. Needs testing with N concurrent workspaces.
- [ ] **Data disk sizing.** Podman images and workspace volumes need space. OCI layers are shared, so N workspaces from the same base image are cheap.
- [ ] **Workspace image build.** Built inside the VM with `podman build`. Part of `vm:deploy`, or a separate `vm:build-workspace` step?
- [ ] **Node version parity.** The VM needs the same Node major version as the codebase expects. Pin in setup script, or detect from `.node-version`/`package.json`?
