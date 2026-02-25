# EDD-019: Linux Support with Firecracker MicroVMs

| Field        | Value                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Author       | mvhenten                                                                                                                                               |
| Status       | Draft                                                                                                                                                  |
| Created      | 2026-02-25                                                                                                                                             |
| Updated      | 2026-02-25                                                                                                                                             |
| Related EDDs | [EDD-001](001_Architecture_Overview.md), [EDD-002](002_MicroVM_Runtime.md), [EDD-005](005_Workspace_Image_Pipeline.md), [EDD-018](018_Repository_Cloning.md) |

## Summary

Add Linux host support to Rockpool by implementing a Firecracker-based runtime that replaces Tart on Linux. Firecracker is AWS's open-source microVM monitor -- it powers Lambda and Fargate, boots in ~125ms, and provides hardware-level isolation via KVM. The existing `RuntimeRepository` interface abstracts the VM runtime; this EDD adds a `createFirecrackerRuntime()` implementation behind that interface. The server detects the host platform at startup and selects the appropriate runtime. No changes to the workspace service, worker, queue, caddy, or database are needed -- the runtime abstraction holds.

This document is written to be self-contained enough for an AI coding agent to implement autonomously on a Linux host.

## How to Use This EDD (for AI agents)

**Read this entire document before writing any code.** Then follow the implementation plan phase by phase, in order. Each phase lists the exact files to create or modify, acceptance criteria, and verification steps. Do not skip ahead.

Key rules:
1. **Read existing code first.** Before creating a new file, read the files it depends on (types, tart-runtime, workspace-service). Match existing patterns exactly.
2. **Run verification after every phase.** Each phase ends with `npm run check` and `npm run lint`. Fix errors before moving on.
3. **Do not modify `packages/runtime/src/types.ts`.** The RuntimeRepository interface is already correct. Your job is to implement it.
4. **Do not modify workspace-service, worker processor, queue, caddy, or db.** The runtime abstraction means these layers don't change.
5. **Match the coding style** in `.claude/rules/typescript.md`: no `any`, no try-catch-rethrow, return early, no comments unless non-obvious.
6. **Shell scripts must be executable** (`chmod +x`) and use `#!/usr/bin/env bash` with `set -euo pipefail`.

## Prerequisites

- [EDD-002](002_MicroVM_Runtime.md) -- Runtime abstraction layer, `RuntimeRepository` interface, Tart implementation
- [EDD-005](005_Workspace_Image_Pipeline.md) -- Image pipeline, Packer builds, shared `setup.sh` provisioning script
- [EDD-018](018_Repository_Cloning.md) -- Repository cloning via `clone()` method on `RuntimeRepository`
- A Linux host with KVM access (`/dev/kvm` readable/writable by the Rockpool process user)
- Firecracker binary installed and on `PATH`

## Problem

Rockpool currently runs only on macOS using Tart (Apple Virtualization Framework). The `RuntimeRepository` interface was designed from the start to support multiple backends (see EDD-002), but only Tart and a test stub exist. Running on Linux requires a new runtime implementation.

Firecracker was evaluated in EDD-002 and rated "gold standard on Linux" but deferred because macOS development was the priority. The architecture is now stable -- the runtime abstraction works well with Tart, and the `configure()` and `clone()` methods operate over SSH, which is runtime-agnostic. Adding a Firecracker backend requires implementing the same interface with Firecracker's REST API instead of Tart's CLI.

Key differences from Tart:

| Concern          | Tart (macOS)                        | Firecracker (Linux)                          |
| ---------------- | ----------------------------------- | -------------------------------------------- |
| VM lifecycle     | `tart` CLI commands                 | REST API over Unix domain socket             |
| Process model    | `tart run` blocks until VM stops    | `firecracker` process = one VM               |
| Image format     | OCI images (tart clone)             | ext4 rootfs + Linux kernel binary            |
| Networking       | macOS vmnet (automatic DHCP)        | TAP devices, manual IP assignment            |
| IP discovery     | `tart ip` polls for DHCP lease      | Static IP assigned at TAP creation           |
| VM identity      | VM name in Tart registry            | Socket path + rootfs file path on disk       |

## Architecture

### Firecracker Process Model

Each Firecracker microVM runs as a separate OS process. The `firecracker` binary takes an `--api-sock` argument pointing to a Unix domain socket. All VM configuration and lifecycle management happens through HTTP requests to that socket. When the process exits, the VM is gone.

```
┌─────────────────────────────────────────────┐
│                 Linux Host                  │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │         Rockpool Control Plane        │  │
│  │  server + worker + caddy + elasticmq  │  │
│  └───────────┬───────────────────────────┘  │
│              │                               │
│  ┌───────────┴───────────────────────────┐  │
│  │      Firecracker Runtime              │  │
│  │                                       │  │
│  │  workspace-abc/                       │  │
│  │    firecracker.sock  ← REST API       │  │
│  │    rootfs.ext4       ← VM disk        │  │
│  │    firecracker.pid   ← process ID     │  │
│  │    firecracker.log   ← VM log         │  │
│  │                                       │  │
│  │  workspace-xyz/                       │  │
│  │    firecracker.sock                   │  │
│  │    rootfs.ext4                        │  │
│  │    ...                                │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │          Bridge: rockpool0            │  │
│  │          172.16.0.1/16                │  │
│  │                                       │  │
│  │  tap-abc (172.16.0.2)  ← VM abc      │  │
│  │  tap-xyz (172.16.0.6)  ← VM xyz      │  │
│  │                                       │  │
│  │  iptables NAT → internet egress      │  │
│  │  iptables FORWARD DROP between VMs   │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Directory Layout

Each workspace VM gets a directory under a configurable base path (default: `$PROJECT_ROOT/.firecracker/vms/`):

```
.firecracker/
  kernel/
    vmlinux                    ← shared kernel binary (all VMs use the same kernel)
  base/
    rockpool-workspace.ext4    ← base rootfs image (read-only template)
  vms/
    workspace-abc/
      rootfs.ext4              ← copy of base image (read-write, this VM's disk)
      firecracker.sock         ← API socket for this VM
      firecracker.pid          ← PID file for the firecracker process
      firecracker.log          ← VM-specific log file
      vm.json                  ← Firecracker JSON config for this VM
    workspace-xyz/
      ...
```

The base image is copied (not linked) for each VM so that each workspace has its own persistent, writable disk. This matches Tart's behavior where `tart clone` creates an independent copy of the base image.

### Networking

Tart on macOS uses vmnet, which provides automatic DHCP and NAT. Firecracker requires explicit TAP device setup. The Firecracker runtime uses a bridge-based network with static IP assignment.

#### Network Design

- **Bridge**: A single Linux bridge `rockpool0` at `172.16.0.1/16`
- **TAP devices**: One TAP per VM, attached to the bridge
- **IP scheme**: Static IPs derived from a counter. Each VM gets `172.16.X.Y` where the address is computed from an incrementing slot number
- **NAT**: iptables MASQUERADE rule on the host's outbound interface for internet egress
- **Isolation**: iptables rules prevent inter-VM traffic. VMs can reach the host (for Caddy) and the internet (via NAT), but not each other

#### IP Assignment

Firecracker does not have DHCP. The guest IP is derived from the MAC address using a convention from Firecracker's `fcnet-setup.sh` script, or configured statically inside the guest via a startup script baked into the rootfs. The runtime assigns deterministic IPs:

- Bridge gateway: `172.16.0.1/16`
- VM slot `n` gets:
  - TAP IP on host side: `172.16.{(n*4) >> 8}.{(n*4) & 0xFF + 1}` with `/30` mask
  - Guest IP: `172.16.{(n*4) >> 8}.{(n*4) & 0xFF + 2}`
  - Guest MAC: derived from guest IP bytes

For simplicity in the initial implementation, use a sequential flat scheme:

| Slot | TAP device   | TAP IP (host) | Guest IP     | Guest MAC         |
| ---- | ------------ | ------------- | ------------ | ----------------- |
| 0    | rp-tap0      | 172.16.0.1/30 | 172.16.0.2   | 06:00:AC:10:00:02 |
| 1    | rp-tap1      | 172.16.0.5/30 | 172.16.0.6   | 06:00:AC:10:00:06 |
| 2    | rp-tap2      | 172.16.0.9/30 | 172.16.0.10  | 06:00:AC:10:00:0A |
| ...  | ...          | ...           | ...          | ...               |

Each TAP gets a `/30` subnet (4 addresses: network, host, guest, broadcast). This isolates VMs at the IP level -- each VM is on its own point-to-point link with the host. The bridge connects all TAPs so the host can route between them and to the internet.

The slot number is persisted in the VM's `vm.json` config file. When a VM is deleted, its slot is freed for reuse. The runtime tracks allocated slots in a simple JSON file (`.firecracker/slots.json`) or derives them from the existing VM directories on disk.

#### TAP Setup Script

TAP creation requires root privileges. The runtime uses a helper script (`npm-scripts/firecracker-net.sh`) that the user runs with `sudo` during initial setup, or that is called by the runtime via `sudo` at VM creation time.

```bash
#!/usr/bin/env bash
set -euo pipefail

ACTION=$1      # "create" or "destroy"
TAP_NAME=$2    # e.g., "rp-tap0"
TAP_IP=$3      # e.g., "172.16.0.1/30"
BRIDGE=$4      # e.g., "rockpool0"

case "$ACTION" in
  create)
    ip tuntap add dev "$TAP_NAME" mode tap
    ip addr add "$TAP_IP" dev "$TAP_NAME"
    ip link set dev "$TAP_NAME" up
    ip link set dev "$TAP_NAME" master "$BRIDGE"
    ;;
  destroy)
    ip link set dev "$TAP_NAME" down 2>/dev/null || true
    ip link del "$TAP_NAME" 2>/dev/null || true
    ;;
esac
```

#### Bridge and NAT Setup Script

One-time host setup script (`npm-scripts/firecracker-bridge-setup.sh`) run once with `sudo` before starting Rockpool:

```bash
#!/usr/bin/env bash
set -euo pipefail

BRIDGE="rockpool0"
BRIDGE_IP="172.16.0.1/16"

# Create bridge if it doesn't exist
if ! ip link show "$BRIDGE" &>/dev/null; then
    ip link add name "$BRIDGE" type bridge
    ip addr add "$BRIDGE_IP" dev "$BRIDGE"
    ip link set dev "$BRIDGE" up
fi

# Enable IP forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward

# Determine outbound interface
HOST_IFACE=$(ip -j route list default | jq -r '.[0].dev')

# NAT for VM internet access
iptables -t nat -C POSTROUTING -o "$HOST_IFACE" -s 172.16.0.0/16 -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -o "$HOST_IFACE" -s 172.16.0.0/16 -j MASQUERADE

# Allow forwarding from bridge
iptables -C FORWARD -i "$BRIDGE" -o "$HOST_IFACE" -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i "$BRIDGE" -o "$HOST_IFACE" -j ACCEPT
iptables -C FORWARD -i "$HOST_IFACE" -o "$BRIDGE" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i "$HOST_IFACE" -o "$BRIDGE" -m state --state RELATED,ESTABLISHED -j ACCEPT

# Block inter-VM traffic (VMs should not talk to each other)
iptables -C FORWARD -i "$BRIDGE" -o "$BRIDGE" -j DROP 2>/dev/null || \
    iptables -A FORWARD -i "$BRIDGE" -o "$BRIDGE" -j DROP

echo "Bridge $BRIDGE configured at $BRIDGE_IP with NAT via $HOST_IFACE"
```

### Image Management

#### Kernel

Firecracker boots a raw Linux kernel binary (`vmlinux`), not a compressed bzImage. The kernel must be compiled with the correct options (virtio, ext4, network drivers). The Firecracker project provides prebuilt kernels for both x86_64 and aarch64.

The kernel binary lives at `.firecracker/kernel/vmlinux`. A setup script downloads it:

```bash
#!/usr/bin/env bash
set -euo pipefail

ARCH=$(uname -m)
FC_VERSION="v1.10.1"
KERNEL_URL="https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-${ARCH}.tgz"

mkdir -p .firecracker/kernel
cd .firecracker/kernel

if [ ! -f vmlinux ]; then
    echo "Downloading Firecracker kernel..."
    curl -fsSL "$KERNEL_URL" | tar xz --strip-components=1 "release-${FC_VERSION}-${ARCH}/vmlinux-*"
    mv vmlinux-* vmlinux
fi
```

Alternatively, build a custom kernel from the Firecracker-maintained kernel config. The prebuilt kernel includes all necessary drivers (virtio-net, virtio-blk, ext4, etc.) and is sufficient for workspace VMs.

#### Rootfs Image

The rootfs is an ext4 filesystem image containing a Debian minimal installation with the same software stack as the Tart image. The existing `images/scripts/setup.sh` provisioning script is reused -- it installs code-server, git, openssh, and configures the systemd services. The only additions for Firecracker are:

1. Static network configuration (the guest must configure its own IP since there is no DHCP)
2. A network setup script that runs at boot to configure the guest interface

**Building the rootfs:**

The rootfs is built using `debootstrap` + `chroot` (or a Docker container for convenience). A Packer build with the QEMU builder can also produce ext4 images, but for Firecracker the simpler approach is a shell script that:

1. Creates an empty ext4 image (e.g., 20GB sparse file)
2. Mounts it
3. Runs `debootstrap` to install Debian minimal
4. Chroots in and runs `setup.sh` plus Firecracker-specific network config
5. Unmounts

The build script lives at `images/scripts/build-firecracker-rootfs.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOTFS_SIZE_MB=20480
ROOTFS_PATH=".firecracker/base/rockpool-workspace.ext4"
SETUP_SCRIPT="images/scripts/setup.sh"

mkdir -p .firecracker/base

# Create sparse file (doesn't actually allocate all space)
dd if=/dev/zero of="$ROOTFS_PATH" bs=1M count=0 seek=$ROOTFS_SIZE_MB
mkfs.ext4 -F "$ROOTFS_PATH"

MOUNT_DIR=$(mktemp -d)
sudo mount "$ROOTFS_PATH" "$MOUNT_DIR"

# Install Debian minimal
sudo debootstrap --include=systemd,systemd-sysv,dbus,iproute2,openssh-server \
    bookworm "$MOUNT_DIR" http://deb.debian.org/debian

# Create admin user
sudo chroot "$MOUNT_DIR" useradd -m -s /bin/bash -G sudo admin
sudo chroot "$MOUNT_DIR" sh -c 'echo "admin:admin" | chpasswd'

# Copy and run the shared setup script
sudo cp "$SETUP_SCRIPT" "$MOUNT_DIR/tmp/setup.sh"
sudo chroot "$MOUNT_DIR" bash /tmp/setup.sh

# Install Firecracker guest network setup
sudo tee "$MOUNT_DIR/etc/systemd/system/rockpool-net.service" > /dev/null <<'EOF'
[Unit]
Description=Rockpool guest network setup
Before=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rockpool-net-setup.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

sudo tee "$MOUNT_DIR/usr/local/bin/rockpool-net-setup.sh" > /dev/null <<'SCRIPT'
#!/bin/bash
# Read IP config from kernel command line
# Format: rockpool.ip=172.16.0.2 rockpool.gw=172.16.0.1 rockpool.mask=30
IP=$(cat /proc/cmdline | tr ' ' '\n' | grep rockpool.ip= | cut -d= -f2)
GW=$(cat /proc/cmdline | tr ' ' '\n' | grep rockpool.gw= | cut -d= -f2)
MASK=$(cat /proc/cmdline | tr ' ' '\n' | grep rockpool.mask= | cut -d= -f2)

if [ -n "$IP" ] && [ -n "$GW" ] && [ -n "$MASK" ]; then
    ip addr add "${IP}/${MASK}" dev eth0
    ip link set dev eth0 up
    ip route add default via "$GW"
    echo "nameserver 1.1.1.1" > /etc/resolv.conf
    echo "nameserver 8.8.8.8" >> /etc/resolv.conf
fi
SCRIPT

sudo chmod +x "$MOUNT_DIR/usr/local/bin/rockpool-net-setup.sh"
sudo chroot "$MOUNT_DIR" systemctl enable rockpool-net.service

# Clean up
sudo rm "$MOUNT_DIR/tmp/setup.sh"
sudo umount "$MOUNT_DIR"
rmdir "$MOUNT_DIR"

echo "Rootfs built at $ROOTFS_PATH"
```

The guest network configuration is passed via kernel boot arguments (`rockpool.ip=`, `rockpool.gw=`, `rockpool.mask=`). This avoids needing to modify the rootfs per-VM -- the same rootfs image is used for all VMs, only the kernel arguments differ. This is a standard Firecracker pattern.

#### Image Reuse

When creating a new workspace, the runtime copies the base rootfs to the VM's directory:

```
cp .firecracker/base/rockpool-workspace.ext4 .firecracker/vms/workspace-abc/rootfs.ext4
```

This copy becomes the workspace's persistent disk. Like Tart, the disk survives stop/start cycles. Unlike Tart, there is no OCI layer deduplication -- each workspace gets a full copy. For the initial implementation this is acceptable. Future optimization: use `cp --reflink=auto` on filesystems that support it (btrfs, XFS), or use overlayfs to layer workspace changes on top of a shared base.

### SSH Access

SSH access to Firecracker VMs works identically to Tart VMs. The rootfs includes `openssh-server` with the Rockpool SSH public key in `~admin/.ssh/authorized_keys` (installed by the shared `setup.sh` script). The runtime connects via `ssh -i <key> admin@<guest-ip>`.

The `configure()` method SSH-es into the VM to write code-server's config and restart the service. The `clone()` method SSH-es in to write git credentials and run `git clone`. Both work unchanged -- they only need the VM's IP address, which the Firecracker runtime provides from its static assignment.

### Firecracker JSON Config

Each VM is configured via a JSON config file written to `vm.json` before starting the Firecracker process. This avoids making sequential API calls over the socket.

```json
{
  "boot-source": {
    "kernel_image_path": "/absolute/path/.firecracker/kernel/vmlinux",
    "boot_args": "console=ttyS0 reboot=k panic=1 pci=off rockpool.ip=172.16.0.2 rockpool.gw=172.16.0.1 rockpool.mask=30"
  },
  "drives": [
    {
      "drive_id": "rootfs",
      "is_root_device": true,
      "is_read_only": false,
      "path_on_host": "/absolute/path/.firecracker/vms/workspace-abc/rootfs.ext4"
    }
  ],
  "machine-config": {
    "vcpu_count": 2,
    "mem_size_mib": 4096,
    "smt": false
  },
  "network-interfaces": [
    {
      "iface_id": "eth0",
      "guest_mac": "06:00:AC:10:00:02",
      "host_dev_name": "rp-tap0"
    }
  ]
}
```

The Firecracker process is started with `--config-file vm.json` instead of making individual API calls. This is cleaner and atomic -- the VM configuration is a single file that can be inspected and debugged.

## Detailed Design

### RuntimeRepository Interface Mapping

The existing interface from `packages/runtime/src/types.ts`:

```typescript
export interface RuntimeRepository {
    create(name: string, image: string): Promise<void>;
    start(name: string): Promise<void>;
    stop(name: string): Promise<void>;
    remove(name: string): Promise<void>;
    status(name: string): Promise<VmStatus>;
    getIp(name: string): Promise<string>;
    configure?(name: string, env: Record<string, string>): Promise<void>;
    clone?(name: string, vmIp: string, repository: string, token?: string): Promise<void>;
}
```

Each method maps to Firecracker operations as follows:

#### `create(name, image)`

1. Allocate a network slot (increment counter, persist to slots file)
2. Create VM directory: `.firecracker/vms/{name}/`
3. Copy base rootfs: `cp {base}/{image}.ext4 {vmDir}/rootfs.ext4`
4. Create TAP device via `sudo npm-scripts/firecracker-net.sh create rp-tap{slot} {tapIp}/{mask} rockpool0`
5. Compute guest IP and MAC from slot number
6. Write `vm.json` with kernel path, rootfs path, network config, boot args including `rockpool.ip={guestIp} rockpool.gw={tapIp} rockpool.mask=30`
7. Do not start the VM yet

#### `start(name)`

1. Read `vm.json` from the VM directory
2. Clean up stale socket file if it exists
3. Spawn the Firecracker process:
   ```
   sudo firecracker --api-sock {vmDir}/firecracker.sock --config-file {vmDir}/vm.json
   ```
   Spawned detached (like Tart's `spawn()` pattern), PID written to `{vmDir}/firecracker.pid`
4. Poll for the socket to become available, then poll `GET /` on the socket for VM state
5. Wait until the VM is running (Firecracker boots in ~125ms, guest userspace takes a few seconds)

Unlike Tart where `start()` polls `tart list`, the Firecracker runtime checks if the process is alive (via the PID file) and if the socket responds.

#### `stop(name)`

1. Read PID from `{vmDir}/firecracker.pid`
2. Send `PUT /actions` with `{"action_type": "SendCtrlAltDel"}` to the API socket for a graceful shutdown
3. Wait for the process to exit (poll PID, timeout after 10 seconds)
4. If the process is still running after timeout, send `SIGKILL`
5. Clean up the socket file
6. Do NOT destroy the TAP device or delete the rootfs (the VM can be restarted)

#### `remove(name)`

1. If the VM is running, stop it first
2. Destroy the TAP device via `sudo npm-scripts/firecracker-net.sh destroy rp-tap{slot} "" rockpool0`
3. Free the network slot
4. Delete the VM directory: `rm -rf {vmDir}/`

#### `status(name)`

1. Check if the VM directory exists. If not: `"not_found"`
2. Check if `firecracker.pid` exists and the process is alive: if not, `"stopped"`
3. If the process is alive, `"running"`

No need to query the Firecracker API for status -- process liveness is sufficient. If the process is alive, the VM is running. If it exited, the VM is stopped.

#### `getIp(name)`

1. Read `vm.json` from the VM directory
2. Parse the guest IP from the boot args (`rockpool.ip=...`) or from the stored slot metadata
3. Return immediately -- no polling needed since IPs are statically assigned

This is a significant improvement over Tart where `getIp()` polls for up to 60 seconds waiting for DHCP. With Firecracker, the IP is known at creation time.

#### `configure(name, env)`

Identical to Tart's implementation. SSH into the VM and write code-server config. The only difference is the IP source -- `getIp()` returns a static value instead of polling.

#### `clone(name, vmIp, repository, token?)`

Identical to Tart's implementation. SSH into the VM, write git credential helper, run `git clone`. No changes needed.

### FirecrackerRuntime Factory

```typescript
// packages/runtime/src/firecracker-runtime.ts

export interface FirecrackerRuntimeOptions {
    basePath?: string;         // default: "{projectRoot}/.firecracker"
    kernelPath?: string;       // default: "{basePath}/kernel/vmlinux"
    baseImageDir?: string;     // default: "{basePath}/base"
    vmDir?: string;            // default: "{basePath}/vms"
    bridgeName?: string;       // default: "rockpool0"
    subnetPrefix?: string;     // default: "172.16"
    vcpuCount?: number;        // default: 2
    memSizeMib?: number;       // default: 4096
    sshKeyPath?: string;       // required for configure/clone
    sshUser?: string;          // default: "admin"
    netScriptPath?: string;    // path to firecracker-net.sh
    exec?: ExecFn;             // injectable for testing
    spawn?: SpawnFn;           // injectable for testing
    pollIntervalMs?: number;
    pollMaxAttempts?: number;
}

export function createFirecrackerRuntime(
    options: FirecrackerRuntimeOptions
): RuntimeRepository
```

The factory follows the same pattern as `createTartRuntime()` -- injectable `exec` and `spawn` functions for testability, configurable poll intervals and timeouts.

### Slot Allocator

The slot allocator manages TAP device numbering and IP assignment. It persists state to `.firecracker/slots.json`:

```json
{
  "allocated": {
    "workspace-abc": 0,
    "workspace-xyz": 1
  },
  "nextSlot": 2
}
```

When a VM is removed, its slot is returned to a free list. The allocator is internal to the Firecracker runtime and not exposed via the `RuntimeRepository` interface.

```typescript
interface SlotAllocation {
    slot: number;
    tapName: string;       // "rp-tap{slot}"
    tapIp: string;         // "172.16.{...}.{...}"
    guestIp: string;       // "172.16.{...}.{...}"
    guestMac: string;      // "06:00:AC:10:00:XX"
    mask: number;          // 30
}

interface SlotAllocator {
    allocate(name: string): SlotAllocation;
    release(name: string): void;
    get(name: string): SlotAllocation | undefined;
    load(): void;   // read from disk
    save(): void;   // write to disk
}
```

### Sudo Requirements

Firecracker itself must run as root (it needs `/dev/kvm`). TAP device creation also requires root. There are two approaches:

**Option A: Run the worker as root.** Simple but coarse-grained. The entire worker process runs as root, which means any bug in the worker has root access.

**Option B: Targeted sudo.** The worker runs as a non-root user with specific sudo permissions for:
- `firecracker` binary
- `ip tuntap` / `ip link` / `ip addr` commands (via the net script)

This is the recommended approach. Add a sudoers entry:

```
rockpool ALL=(root) NOPASSWD: /usr/local/bin/firecracker, /usr/local/bin/npm-scripts/firecracker-net.sh
```

The runtime's `exec` function prepends `sudo` to privileged commands. The `sshExec` function (for `configure` and `clone`) does not need sudo -- SSH runs as the regular user.

Alternatively, use a setuid helper or grant the Rockpool user access to `/dev/kvm` and `/dev/net/tun` via udev rules, which avoids sudo for Firecracker and TAP creation entirely:

```bash
# /etc/udev/rules.d/99-rockpool.rules
KERNEL=="kvm", GROUP="rockpool", MODE="0660"
KERNEL=="tun", GROUP="rockpool", MODE="0660"
```

This approach requires the `rockpool` user to be in the appropriate group. Document both options and let the operator choose.

### Platform Detection and Runtime Selection

The server already has platform detection in `packages/server/src/config.ts`:

```typescript
platform: (process.env.PLATFORM ?? process.platform) as "darwin" | "linux",
```

And runtime selection in `packages/server/src/index.ts`:

```typescript
const useStubVm = process.env.RUNTIME !== "tart";
const runtime = useStubVm
    ? createStubRuntime()
    : createTartRuntime({ sshKeyPath: config.sshKeyPath });
```

This changes to support three modes:

```typescript
function createRuntimeFromConfig(config: ServerConfig): RuntimeRepository {
    const runtimeEnv = process.env.RUNTIME;

    if (runtimeEnv === "stub" || process.env.NODE_ENV === "test") {
        return createStubRuntime();
    }

    if (runtimeEnv === "firecracker" || (!runtimeEnv && config.platform === "linux")) {
        return createFirecrackerRuntime({
            sshKeyPath: config.sshKeyPath,
            basePath: config.firecrackerBasePath,
        });
    }

    if (runtimeEnv === "tart" || (!runtimeEnv && config.platform === "darwin")) {
        return createTartRuntime({ sshKeyPath: config.sshKeyPath });
    }

    return createStubRuntime();
}
```

The `RUNTIME` environment variable takes precedence. If not set, the platform determines the default: `tart` on macOS, `firecracker` on Linux. The stub is always available for testing. The same logic applies to `packages/worker/src/main.ts`.

### Config Changes

Add to `ServerConfig` in `packages/server/src/config.ts`:

```typescript
firecrackerBasePath: string;  // default: resolve(projectRoot, ".firecracker")
```

Add to `development.env.example`:

```
# Runtime: "tart" (macOS), "firecracker" (Linux), "stub" (tests)
# Auto-detected from platform if not set
# RUNTIME=firecracker
# FIRECRACKER_BASE_PATH=.firecracker
```

## Implementation Plan

### Phase 1: Firecracker Runtime Basics

Create the `createFirecrackerRuntime()` function implementing `create`, `start`, `stop`, `remove`, `status`, and `getIp`.

**Produces:**
- `packages/runtime/src/firecracker-runtime.ts` -- runtime implementation
- `packages/runtime/src/slot-allocator.ts` -- network slot management
- `packages/runtime/test/firecracker-runtime.test.ts` -- unit tests with injected exec/spawn

**Acceptance criteria:**
- Unit tests pass with mocked exec/spawn
- `create()` writes vm.json and copies rootfs
- `start()` spawns firecracker process and waits for boot
- `stop()` sends SendCtrlAltDel and waits for process exit
- `remove()` cleans up directory and TAP device
- `status()` returns correct state based on process liveness
- `getIp()` returns static IP from slot allocation
- `npm run check` passes
- `npm run lint` passes

### Phase 2: Networking Setup

Create the network helper scripts for bridge and TAP device management.

**Produces:**
- `npm-scripts/firecracker-bridge-setup.sh` -- one-time bridge + NAT setup
- `npm-scripts/firecracker-net.sh` -- per-VM TAP create/destroy
- `npm-scripts/firecracker-setup.sh` -- downloads Firecracker binary + kernel

**Acceptance criteria:**
- Bridge script creates `rockpool0` bridge with NAT
- TAP script creates and destroys TAP devices attached to the bridge
- Setup script downloads Firecracker binary and kernel
- Scripts are idempotent (safe to run multiple times)
- Scripts handle errors and print clear messages

### Phase 3: Rootfs Image Building

Create the rootfs build pipeline that produces an ext4 image with the Rockpool workspace stack.

**Produces:**
- `images/scripts/build-firecracker-rootfs.sh` -- builds ext4 rootfs from debootstrap + setup.sh
- `images/firecracker/rockpool-net-setup.sh` -- guest-side network config (baked into rootfs)
- `images/firecracker/rockpool-net.service` -- systemd unit for guest network (baked into rootfs)
- Makefile target: `$(STAMP_DIR)/firecracker-rootfs`

**Acceptance criteria:**
- Script produces a bootable ext4 image at `.firecracker/base/rockpool-workspace.ext4`
- Image contains: Debian bookworm, systemd, code-server, git, openssh-server, curl, jq, make
- Image has the Rockpool SSH public key in `~admin/.ssh/authorized_keys`
- Image has the guest network setup service that reads IP from kernel cmdline
- code-server starts on boot and listens on `0.0.0.0:8080`
- The shared `images/scripts/setup.sh` is reused (not duplicated)

### Phase 4: Integration with Workspace Service and Worker

Wire the Firecracker runtime into the server and worker startup code.

**Produces:**
- Modified `packages/server/src/config.ts` -- add `firecrackerBasePath`
- Modified `packages/server/src/index.ts` -- platform-aware runtime selection
- Modified `packages/worker/src/main.ts` -- platform-aware runtime selection
- Modified `packages/runtime/src/index.ts` -- export `createFirecrackerRuntime`
- Modified `development.env.example` -- add RUNTIME and FIRECRACKER_BASE_PATH

**Acceptance criteria:**
- On Linux with `RUNTIME=firecracker`, server and worker use the Firecracker runtime
- On macOS with `RUNTIME=tart` (or no RUNTIME set), behavior is unchanged
- With `RUNTIME=stub` or `NODE_ENV=test`, stub runtime is used (unchanged)
- `npm run check` passes
- `npm run lint` passes
- Existing tests continue to pass (they use the stub runtime)

### Phase 5: Ecosystem Configs and PM2

Update PM2 ecosystem configs for Linux operation. On Linux, ElasticMQ requires Java, Caddy is the same, but there is no need for a `TART_HOME` env var.

**Produces:**
- Modified `ecosystem.caddy.config.cjs` -- conditional TART_HOME vs FIRECRACKER_BASE_PATH
- Optionally: `ecosystem.linux.config.cjs` if the configs diverge significantly
- Modified `npm-scripts/preflight.sh` -- check for Firecracker binary, KVM access, bridge setup on Linux

**Acceptance criteria:**
- `npm run dev` on Linux starts all processes correctly
- Preflight check reports missing Firecracker binary or KVM access
- Existing macOS workflow is unaffected

### Phase 6: End-to-End Validation

Manual and automated testing on a Linux host.

**Produces:**
- Integration test documentation
- Any bug fixes discovered during testing

**Acceptance criteria:**
- Create a workspace on Linux: VM boots, code-server is accessible via Caddy
- Stop and restart a workspace: VM disk persists, code-server comes back
- Delete a workspace: VM and TAP device cleaned up
- Clone a repository during workspace creation: code opens in cloned directory
- Multiple concurrent workspaces: each on its own TAP, no IP conflicts
- VM cannot reach other VMs (iptables isolation verified)

## Configure and Clone: No Changes Needed

The `configure()` and `clone()` methods in the Tart runtime operate entirely over SSH. They connect to the VM's IP address using the Rockpool SSH key and execute commands. This pattern works identically for Firecracker VMs because:

1. The rootfs includes `openssh-server` and the Rockpool public key (installed by the shared `setup.sh`)
2. The VM has a reachable IP address on the host's bridge network
3. SSH is available as soon as `sshd` starts (~2-3 seconds after boot)

The Firecracker runtime can reuse the exact same `sshExec`, `configure`, and `clone` implementations. To avoid code duplication, extract the SSH-based methods into a shared module:

```typescript
// packages/runtime/src/ssh-commands.ts
export function createSshCommands(options: {
    sshKeyPath: string;
    sshUser: string;
    exec: ExecFn;
    pollIntervalMs: number;
    pollMaxAttempts: number;
}): {
    sshExec(vmIp: string, cmd: string): Promise<string>;
    configure(name: string, getIp: (name: string) => Promise<string>, env: Record<string, string>): Promise<void>;
    clone(name: string, vmIp: string, repository: string, token?: string): Promise<void>;
}
```

Both `createTartRuntime` and `createFirecrackerRuntime` use this shared module. The Tart-specific `create`, `start`, `stop`, `remove`, `status`, and `getIp` remain in `tart-runtime.ts`. The Firecracker-specific versions go in `firecracker-runtime.ts`. The SSH-based `configure` and `clone` are shared.

## Testing Strategy

### Unit Tests (packages/runtime/test/firecracker-runtime.test.ts)

The Firecracker runtime follows the same testability pattern as the Tart runtime -- injectable `exec` and `spawn` functions. Unit tests verify:

- `create()` calls `cp` to copy rootfs, writes vm.json, calls the net script to create TAP
- `start()` spawns `firecracker` with correct args, polls for process liveness
- `stop()` sends SendCtrlAltDel via the socket API, waits for process exit
- `remove()` calls the net script to destroy TAP, removes VM directory
- `status()` returns correct VmStatus based on directory and PID file existence
- `getIp()` returns the statically assigned IP from the slot allocator
- Slot allocator correctly manages allocation, release, and persistence
- IP and MAC address computation from slot numbers is correct

### Unit Tests (packages/runtime/test/slot-allocator.test.ts)

- Allocating a slot returns monotonically increasing slot numbers
- Releasing a slot makes it available for reuse
- `get()` returns the allocation for an existing VM
- `get()` returns undefined for a non-existent VM
- State round-trips through save/load

### Integration Tests (Linux host only)

These tests require a Linux host with KVM and Firecracker installed. They are skipped in CI (which runs on macOS or GitHub Actions Ubuntu without KVM).

- Create and start a VM: verify process is running, SSH is reachable
- Stop a VM: verify process exited, rootfs still exists
- Restart a stopped VM: verify process starts, SSH reachable, disk state preserved
- Delete a VM: verify directory and TAP device cleaned up
- Multiple VMs: verify unique IPs, no conflicts
- Network isolation: verify VMs cannot ping each other

### Existing Tests Unaffected

All existing tests use `RUNTIME=stub` (or `NODE_ENV=test`). The Firecracker runtime is never instantiated in tests unless explicitly requested. The workspace-service tests, worker processor tests, and E2E tests continue to work unchanged.

## File Manifest

### New Files

```
packages/runtime/src/firecracker-runtime.ts      -- Firecracker RuntimeRepository implementation
packages/runtime/src/slot-allocator.ts            -- Network slot allocation and persistence
packages/runtime/src/ssh-commands.ts              -- Shared SSH-based configure/clone extracted from tart-runtime
packages/runtime/test/firecracker-runtime.test.ts -- Unit tests for Firecracker runtime
packages/runtime/test/slot-allocator.test.ts      -- Unit tests for slot allocator
npm-scripts/firecracker-bridge-setup.sh           -- One-time bridge + NAT setup (run with sudo)
npm-scripts/firecracker-net.sh                    -- Per-VM TAP create/destroy (called by runtime)
npm-scripts/firecracker-setup.sh                  -- Download Firecracker binary + kernel
images/scripts/build-firecracker-rootfs.sh        -- Build ext4 rootfs image
images/firecracker/rockpool-net-setup.sh          -- Guest-side network config script (baked into rootfs)
images/firecracker/rockpool-net.service           -- Guest-side systemd unit (baked into rootfs)
```

### Modified Files

```
packages/runtime/src/index.ts                     -- Export createFirecrackerRuntime
packages/runtime/src/tart-runtime.ts              -- Extract SSH commands to shared module, import from ssh-commands.ts
packages/server/src/config.ts                     -- Add firecrackerBasePath to ServerConfig
packages/server/src/index.ts                      -- Platform-aware runtime selection (replace useStubVm logic)
packages/worker/src/main.ts                       -- Platform-aware runtime selection (same pattern as server)
ecosystem.caddy.config.cjs                        -- Add FIRECRACKER_BASE_PATH env for Linux
npm-scripts/preflight.sh                          -- Add Linux-specific checks (firecracker binary, KVM, bridge)
Makefile                                          -- Add firecracker-rootfs target
development.env.example                           -- Add RUNTIME and FIRECRACKER_BASE_PATH
.gitignore                                        -- Add .firecracker/
```

### Unchanged Files

```
packages/runtime/src/types.ts                     -- RuntimeRepository interface is sufficient, no changes needed
packages/runtime/src/stub-runtime.ts              -- No changes
packages/workspace-service/                       -- No changes (runtime abstraction holds)
packages/worker/src/processor.ts                  -- No changes (calls workspace-service, not runtime directly)
packages/queue/                                   -- No changes
packages/caddy/                                   -- No changes
packages/db/                                      -- No changes
typespec/                                         -- No changes
```

## Decisions

| Question | Decision | Rationale |
| --- | --- | --- |
| Network topology | Bridge with per-VM `/30` TAP subnets | Provides inter-VM isolation at the IP level. Each VM has a point-to-point link with the host. Bridge connects them for host routing. |
| IP assignment | Static, derived from slot number | Firecracker has no DHCP. Static assignment means `getIp()` returns instantly -- no 60-second polling like Tart. IPs passed via kernel boot args. |
| Guest network config | Kernel cmdline args + systemd service | Avoids per-VM rootfs modification. Same base image for all VMs. Standard pattern in Firecracker deployments. |
| Rootfs build tool | debootstrap + chroot (shell script) | Simpler than Packer for ext4 images. Packer's QEMU builder works but adds complexity. Shell script is transparent and debuggable. |
| SSH code reuse | Extract to shared `ssh-commands.ts` | `configure()` and `clone()` are identical between Tart and Firecracker. Shared module avoids duplication. |
| Sudo strategy | Targeted sudo for `firecracker` and net scripts | Avoids running the entire worker as root. Principle of least privilege. Document udev alternative for operators who prefer no sudo. |
| VM config method | JSON config file, not sequential API calls | Atomic configuration. Single file to inspect/debug. Avoids timing issues with async API calls. |
| Rootfs copy strategy | Full copy per workspace | Simple, matches Tart behavior. Each workspace has its own disk. Optimize with reflink later if needed. |
| Runtime auto-detection | Platform-based default, overridable via RUNTIME env | `darwin` defaults to Tart, `linux` defaults to Firecracker. Explicit override for testing or non-standard setups. |
| Firecracker process lifecycle | One process per VM, PID file tracked | Standard Firecracker model. Process exit = VM stopped. No daemon or management layer. |

## Host Prerequisites

### Required Software

| Software | Purpose | Installation |
| --- | --- | --- |
| Firecracker | MicroVM monitor | `npm-scripts/firecracker-setup.sh` or manual download from GitHub releases |
| Linux kernel (vmlinux) | Boots inside the microVM | Downloaded by `firecracker-setup.sh` from Firecracker releases |
| iproute2 | TAP and bridge management | `apt install iproute2` (usually pre-installed) |
| iptables | NAT and isolation rules | `apt install iptables` (usually pre-installed) |
| debootstrap | Building rootfs images | `apt install debootstrap` |
| jq | Network interface detection in scripts | `apt install jq` |
| Java (JRE) | ElasticMQ queue | `apt install default-jre-headless` |
| Node.js >= 22 | Rockpool runtime | nvm or system package |
| Caddy | Reverse proxy | Download from caddyserver.com or system package |

### System Requirements

| Requirement | Check | Notes |
| --- | --- | --- |
| KVM access | `ls -la /dev/kvm` | User must have read/write access. Add to `kvm` group: `sudo usermod -aG kvm $USER` |
| TUN device | `ls -la /dev/net/tun` | Required for TAP devices. Usually available by default. |
| IP forwarding | `cat /proc/sys/net/ipv4/ip_forward` should be `1` | Set by bridge setup script. Persists via sysctl config. |
| Disk space | ~2GB per workspace (rootfs copy) + base image | 50GB recommended minimum for reasonable number of workspaces |

### Setup Sequence

```bash
# 1. Install system dependencies
sudo apt install -y iproute2 iptables debootstrap jq default-jre-headless

# 2. Ensure KVM access
sudo usermod -aG kvm $USER
# (log out and back in)

# 3. Download Firecracker + kernel
npm-scripts/firecracker-setup.sh

# 4. Build the rootfs image
sudo images/scripts/build-firecracker-rootfs.sh

# 5. Set up the network bridge (one-time)
sudo npm-scripts/firecracker-bridge-setup.sh

# 6. Configure sudo for the runtime (if not running as root)
echo "$USER ALL=(root) NOPASSWD: $(which firecracker), $(pwd)/npm-scripts/firecracker-net.sh" | sudo tee /etc/sudoers.d/rockpool

# 7. Start Rockpool
npm run dev
```

## Open Questions

- [ ] **Kernel version pinning.** Should we pin to a specific Firecracker release's kernel, or build a custom kernel? The prebuilt kernel is convenient but may lack drivers needed for specific workloads. Start with prebuilt, build custom if needed.
- [ ] **Rootfs size.** 20GB sparse file means the actual disk usage grows as the workspace fills. Should we set a smaller default and let users expand, or is 20GB the right default?
- [ ] **Copy-on-write rootfs.** `cp --reflink=auto` would save disk space on btrfs/XFS. Should we detect filesystem support and use it automatically? Or defer to later?
- [ ] **Memory balloon.** Firecracker supports memory ballooning for overcommit. Should we enable it so idle workspaces release memory back to the host?
- [ ] **Snapshot/restore.** Firecracker supports pausing and snapshotting VMs. This could replace stop/start for much faster resume (~5ms vs ~3-5s). Worth pursuing as a future optimization.
- [ ] **aarch64 support.** Firecracker supports both x86_64 and aarch64. The rootfs and kernel need to match the host architecture. The build scripts should detect `uname -m` and fetch the correct artifacts. For now, assume x86_64 as the primary Linux target.
- [ ] **CI testing.** GitHub Actions runners don't have KVM. Integration tests on Linux need a self-hosted runner or a nested VM setup. How to handle this in CI?
- [ ] **Multiple base images.** Currently there is one base image (`rockpool-workspace`). The `image` parameter in `create(name, image)` maps to an OCI image name for Tart. For Firecracker, it maps to an ext4 file in `.firecracker/base/{image}.ext4`. Do we need to support multiple base images from the start, or is one sufficient?
