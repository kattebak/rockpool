# EDD: Rootless VM Image Build

| Field        | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| Author       | mvhenten                                                       |
| Status       | Draft                                                          |
| Created      | 2026-03-01                                                     |
| Related EDDs | [EDD-022](022_Root_VM.md)                                      |

## Summary

The Root VM image build (`images/root-vm/build-root-vm.sh`) requires `sudo` because it uses `debootstrap`, `losetup`, `mount`, and `grub-install` — all of which need real root. This creates a manual step in the developer workflow and prevents the build from running in CI without privileged runners.

This EDD replaces the build with a fully rootless pipeline: `mmdebstrap` for the rootfs, `mke2fs -d` for the disk image, and QEMU direct kernel boot instead of GRUB. Every step runs as an unprivileged user.

## Motivation

The current build has three root-requiring operations:

| Operation | Why it needs root | Rootless replacement |
|-----------|-------------------|---------------------|
| `debootstrap` | Creates device nodes, sets uid/gid ownership via real syscalls | `mmdebstrap --mode=unshare` (user namespace) |
| `losetup` + `mount` + `mkfs.ext4` | Kernel block device and mount operations | `mke2fs -d` (writes ext4 structures to a file, no kernel involvement) |
| `grub-install` | Writes MBR to a loop device, needs real root | Eliminated: QEMU direct kernel boot (`-kernel`, `-initrd`, `-append`) |

After this change:
- `sudo` is never needed for building or running the Root VM
- The build can run in unprivileged CI (GitHub Actions, standard runners)
- The `.qemu/` ownership problem (issue #8 in EDD-022) disappears

## Key Technologies

### mmdebstrap

`mmdebstrap` is a reimplementation of `debootstrap` that supports rootless operation. In `--mode=unshare`, it creates a Linux user namespace where the process appears to be root (uid 0), but is actually mapped to the invoking user on the host. This is the same mechanism Podman uses for rootless containers.

| Mode | Root required | Device nodes | Output fidelity |
|------|--------------|--------------|-----------------|
| `root` | Yes | Real `mknod` | Reference |
| `unshare` | No | Handled via user namespace | Bit-identical to root mode |
| `fakechroot` | No | Faked via LD_PRELOAD | Works but fragile |

`--mode=unshare` requires `/etc/subuid` and `/etc/subgid` entries for the user, plus `newuidmap`/`newgidmap` — both are standard Podman prerequisites already satisfied on the host.

Output format: `mmdebstrap` can produce a tarball, a directory, or an ext4 image directly. The tarball output is most useful because it preserves all uid/gid, permissions, device nodes, and symlinks regardless of the user running the command, and can be piped directly into `mke2fs -d`.

Version: Debian Bookworm ships mmdebstrap 1.3.x which fully supports `--mode=unshare`.

### mke2fs -d (populate ext4 from directory or tarball)

The `-d` flag on `mke2fs` populates a new ext4 filesystem from a directory tree or tarball. It writes file data, metadata, ownership, permissions, and device nodes directly into the ext4 on-disk structures — no `mount`, no `losetup`, no kernel involvement. Device nodes are written as ext4 inode metadata (not via the `mknod` syscall), so they work without `CAP_MKNOD`.

Tarball input (pipe from stdin) was added in e2fsprogs 1.45.1. Debian Bookworm ships e2fsprogs 1.47.0, which includes all necessary fixes: 32-bit uid/gid support, files exceeding 2 GiB, and large inode numbers.

```bash
# Create a 10 GB ext4 image populated from a tarball — no root needed
mke2fs -t ext4 -d rootfs.tar -E root_owner=0:0 rootfs.raw 10G
```

### QEMU direct kernel boot

QEMU can load a Linux kernel and initrd directly into guest memory, bypassing BIOS and bootloader entirely. The kernel is passed via command-line flags:

```bash
qemu-system-x86_64 \
  -enable-kvm -cpu host -m 8G -smp 4 \
  -kernel .qemu/vmlinuz \
  -initrd .qemu/initrd.img \
  -append "root=/dev/vda rw console=ttyS0,115200n8 rootwait" \
  -drive file=.qemu/rockpool-root.qcow2,format=qcow2,if=virtio \
  -nographic
```

Advantages over GRUB:
- **Faster boot** — no BIOS POST, no bootloader menu, no filesystem driver loading
- **No partition table needed** — the entire disk image is a single ext4 filesystem, addressed as `/dev/vda`
- **No GRUB maintenance** — no `grub-install`, no `update-grub`, no MBR, no loop devices
- **Kernel updates are a file copy** — kernel and initrd live on the host filesystem, outside the disk image

All existing features work identically: virtio-net, virtiofs, serial console, user-mode networking with port forwarding.

## Current Build Pipeline

```
sudo bash build-root-vm.sh
  │
  ├─ dd + parted + losetup      ← root: loop devices, partition table
  ├─ mkfs.ext4 + mount           ← root: format and mount
  ├─ debootstrap                  ← root: chroot, device nodes, ownership
  ├─ chroot + setup-root-vm.sh   ← root: mount /dev /proc /sys
  ├─ grub-install + update-grub  ← root: MBR write to loop device
  ├─ umount + losetup -d         ← root: cleanup
  └─ qemu-img convert            ← no root needed
```

Output: `.qemu/rockpool-root.qcow2` (bootable disk with MBR + GRUB + ext4 partition)

## Proposed Build Pipeline

```
bash build-root-vm.sh           ← no sudo
  │
  ├─ mmdebstrap --mode=unshare  ← rootless: user namespace, outputs tarball
  │    --include=linux-image-amd64,systemd,...
  │    bookworm rootfs.tar
  │
  ├─ Extract kernel + initrd    ← rootless: tar xf
  │    tar xf rootfs.tar --include='./boot/vmlinuz-*' --include='./boot/initrd.img-*'
  │
  ├─ Run setup script           ← rootless: unshare + chroot
  │    (install Caddy, ElasticMQ, Podman, SSH config, networking)
  │
  ├─ mke2fs -d rootfs.tar       ← rootless: populate ext4 from tarball
  │    mke2fs -t ext4 -d rootfs.tar rootfs.raw 60G
  │
  ├─ qemu-img convert -c        ← rootless: raw → compressed qcow2
  │    qemu-img convert -f raw -O qcow2 -c rootfs.raw rockpool-root.qcow2
  │
  └─ Output:
       .qemu/rockpool-root.qcow2  (raw ext4, no partition table)
       .qemu/vmlinuz               (kernel, for -kernel flag)
       .qemu/initrd.img            (initramfs, for -initrd flag)
```

### Running the setup script without root

The current `setup-root-vm.sh` runs inside a real chroot with `/dev`, `/proc`, `/sys` bind-mounted. In the rootless pipeline, we need an alternative.

**Option A: Run setup inside `mmdebstrap` hooks.** `mmdebstrap` supports `--customize-hook` which runs a script inside the rootfs at the end of the build, with `/dev`, `/proc`, `/sys` already mounted. This is the cleanest approach:

```bash
mmdebstrap --mode=unshare \
  --include=systemd,openssh-server,sudo,linux-image-amd64,... \
  --customize-hook='copy-in setup-root-vm.sh /tmp' \
  --customize-hook='chroot "$1" bash /tmp/setup-root-vm.sh' \
  --customize-hook='rm "$1/tmp/setup-root-vm.sh"' \
  bookworm rootfs.tar
```

The customize hook runs inside the same user namespace, so `chroot`, `apt-get install`, `useradd`, `chown`, `systemctl enable` all work.

**Option B: Two-stage build inside a Podman container.** Use `podman build` with a Dockerfile that runs `mmdebstrap` and the setup script:

```dockerfile
FROM debian:bookworm
RUN apt-get update && apt-get install -y mmdebstrap qemu-utils e2fsprogs
COPY setup-root-vm.sh /build/
RUN mmdebstrap --mode=chrootless \
      --include=systemd,openssh-server,... \
      bookworm /rootfs
RUN chroot /rootfs bash /build/setup-root-vm.sh
RUN mke2fs -t ext4 -d /rootfs rootfs.raw 60G
RUN qemu-img convert -f raw -O qcow2 -c rootfs.raw /output/rockpool-root.qcow2
```

This is more complex and slower (builds a container to build the VM). Option A is preferred.

**Option C: `unshare --user --map-root-user` wrapper.** Run the entire build inside a user namespace created by `unshare(1)`:

```bash
unshare --user --map-root-user --mount --pid --fork bash -c '
  mmdebstrap bookworm /rootfs
  chroot /rootfs bash /tmp/setup-root-vm.sh
  mke2fs -t ext4 -d /rootfs rootfs.raw 60G
'
```

This requires `newuidmap`/`newgidmap` on the host (already a Podman prerequisite). Simpler than option B but less isolated.

### Recommended approach: Option A (mmdebstrap hooks)

The setup script needs minor adaptation:
- `systemctl enable` calls already have `|| ln -sf` fallbacks (work in chroot)
- `apt-get install` works inside mmdebstrap hooks
- `curl` for Caddy repo and ElasticMQ jar works (network access available during build)
- `useradd`, `chown`, `chmod` work inside the user namespace

The only change needed: split `setup-root-vm.sh` into package installation (can be done via `--include` and `--essential-hook`) and configuration (done in `--customize-hook`). Or keep the existing script and run it as a single customize hook.

## Changes to start-root-vm.sh

The start script needs three changes:

1. **Add `-kernel` and `-initrd` flags** pointing to the extracted kernel and initramfs
2. **Add `-append` with kernel command line**: `root=/dev/vda rw console=ttyS0,115200n8 rootwait`
3. **Change `-drive`**: remove partition-aware options, use the qcow2 directly as a virtio block device

Before:
```bash
qemu-system-x86_64 \
  -drive file=rockpool-root.qcow2,format=qcow2 \
  ...
```

After:
```bash
qemu-system-x86_64 \
  -kernel .qemu/vmlinuz \
  -initrd .qemu/initrd.img \
  -append "root=/dev/vda rw console=ttyS0,115200n8 rootwait" \
  -drive file=.qemu/rockpool-root.qcow2,format=qcow2,if=virtio \
  ...
```

No other changes needed. Virtiofs, port forwarding, and networking remain identical.

## Changes to fstab

Without a partition table, the root device changes from a UUID-based partition to `/dev/vda`:

Before:
```
UUID=<part-uuid>  /  ext4  errors=remount-ro  0 1
```

After:
```
/dev/vda  /  ext4  errors=remount-ro  0 1
```

The virtiofs mount is unchanged:
```
rockpool /mnt/rockpool virtiofs defaults,nofail 0 0
```

## Host Prerequisites

### Current (with sudo)

```bash
sudo apt install qemu-system-x86 qemu-utils debootstrap virtiofsd grub-pc-bin
```

### Proposed (no sudo)

```bash
sudo apt install qemu-system-x86 qemu-utils mmdebstrap virtiofsd e2fsprogs
```

The only `sudo` is for installing packages, which is a one-time system setup (same as installing Podman). The actual build and run are fully rootless.

Removed dependencies: `debootstrap`, `grub-pc-bin`, `parted`.
Added dependencies: `mmdebstrap`.
Unchanged: `qemu-system-x86`, `qemu-utils`, `virtiofsd`, `e2fsprogs` (already installed).

## Scope

### In scope

- Replace `build-root-vm.sh` with a rootless version using `mmdebstrap` + `mke2fs -d` + `qemu-img convert`
- Switch from GRUB boot to QEMU direct kernel boot (`-kernel`, `-initrd`, `-append`)
- Update `start-root-vm.sh` for direct kernel boot
- Adapt `setup-root-vm.sh` for mmdebstrap hook execution
- Extract kernel and initrd to `.qemu/vmlinuz` and `.qemu/initrd.img`
- Update README and EDD-022 setup instructions
- Remove `sudo` from the build workflow entirely

### Out of scope

- Changing the workspace container image build (already rootless via `podman build`)
- CI integration (future work, but this unblocks it)
- macOS / Tart support

## Verification

- `bash images/root-vm/build-root-vm.sh` completes without `sudo`
- `.qemu/rockpool-root.qcow2`, `.qemu/vmlinuz`, `.qemu/initrd.img` are produced
- `npm run start:vm` boots the VM via direct kernel boot
- SSH into the VM works
- Virtiofs mount works (`/mnt/rockpool/package.json` exists)
- All services start (Caddy, server, worker, ElasticMQ)
- `npm run test:e2e:podman` passes (same results as before)

## Risks

- **mmdebstrap hook network access.** The setup script downloads Caddy and ElasticMQ. `mmdebstrap --mode=unshare` provides network access by default, but some hardened systems may block it. Mitigation: pre-download artifacts and `copy-in` during the hook.
- **Kernel version drift.** The kernel and initrd are extracted once at build time and stored on the host. If the qcow2 image's `/lib/modules` doesn't match the extracted kernel, modules won't load. Mitigation: both come from the same mmdebstrap run, so they're always in sync. Only becomes an issue if someone updates the kernel inside the VM without re-extracting.
- **Disk image sizing.** `mke2fs -d` requires a pre-specified size. Too small and the build fails. Too large and the sparse file is fine but qcow2 metadata grows. Current 60 GB is generous for the base install (~2 GB actual data).
