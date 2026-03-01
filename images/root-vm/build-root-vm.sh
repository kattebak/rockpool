#!/usr/bin/env bash
set -euo pipefail

# Build a bootable QEMU qcow2 disk image for the Rockpool Root VM.
# Requires: debootstrap, qemu-utils, root privileges
#
# Usage: sudo images/root-vm/build-root-vm.sh [output-dir]
#
# Produces: <output-dir>/rockpool-root.qcow2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUTPUT_DIR="${1:-${ROOT_DIR}/.qemu}"
SETUP_SCRIPT="${SCRIPT_DIR}/setup-root-vm.sh"
SSH_PUBKEY="${SCRIPT_DIR}/keys/rockpool-root-vm_ed25519.pub"
RAW_IMAGE="${OUTPUT_DIR}/rockpool-root.raw"
QCOW2_IMAGE="${OUTPUT_DIR}/rockpool-root.qcow2"
IMAGE_SIZE_MB=61440
VM_USER="admin"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root (sudo)."
  exit 1
fi

for cmd in debootstrap qemu-img grub-install; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: ${cmd} is not installed."
    echo "Install with: apt install debootstrap qemu-utils grub-pc-bin grub2-common"
    exit 1
  fi
done

if [ ! -f "$SETUP_SCRIPT" ]; then
  echo "ERROR: Setup script not found at $SETUP_SCRIPT"
  exit 1
fi

if [ ! -f "$SSH_PUBKEY" ]; then
  echo "ERROR: SSH public key not found at $SSH_PUBKEY"
  echo "Generate it with: ssh-keygen -t ed25519 -f images/root-vm/keys/rockpool-root-vm_ed25519 -N '' -C 'rockpool-root-vm'"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

MOUNT_DIR=$(mktemp -d)
LOOP_DEV=""

cleanup() {
  echo "Cleaning up..."
  if mountpoint -q "${MOUNT_DIR}/dev/pts" 2>/dev/null; then umount "${MOUNT_DIR}/dev/pts" || true; fi
  if mountpoint -q "${MOUNT_DIR}/dev" 2>/dev/null; then umount "${MOUNT_DIR}/dev" || true; fi
  if mountpoint -q "${MOUNT_DIR}/proc" 2>/dev/null; then umount "${MOUNT_DIR}/proc" || true; fi
  if mountpoint -q "${MOUNT_DIR}/sys" 2>/dev/null; then umount "${MOUNT_DIR}/sys" || true; fi
  if mountpoint -q "${MOUNT_DIR}/run" 2>/dev/null; then umount "${MOUNT_DIR}/run" || true; fi
  if mountpoint -q "${MOUNT_DIR}" 2>/dev/null; then umount "${MOUNT_DIR}" || true; fi
  if [ -n "$LOOP_DEV" ]; then losetup -d "$LOOP_DEV" 2>/dev/null || true; fi
  rmdir "$MOUNT_DIR" 2>/dev/null || true
}
trap cleanup EXIT

echo "Creating raw disk image (${IMAGE_SIZE_MB}MB sparse)..."
dd if=/dev/zero of="$RAW_IMAGE" bs=1M count=0 seek=$IMAGE_SIZE_MB 2>/dev/null

echo "Partitioning disk image..."
parted -s "$RAW_IMAGE" \
  mklabel msdos \
  mkpart primary ext4 1MiB 100%

LOOP_DEV=$(losetup --find --show --partscan "$RAW_IMAGE")
PART_DEV="${LOOP_DEV}p1"

for i in $(seq 1 10); do
  [ -b "$PART_DEV" ] && break
  partprobe "$LOOP_DEV" 2>/dev/null || true
  sleep 0.5
done

if [ ! -b "$PART_DEV" ]; then
  echo "ERROR: Partition device ${PART_DEV} not found."
  exit 1
fi

echo "Formatting partition..."
mkfs.ext4 -F -q "$PART_DEV"

echo "Mounting partition..."
mount "$PART_DEV" "$MOUNT_DIR"

echo "Installing Debian Bookworm via debootstrap..."
debootstrap \
  --include=systemd,systemd-sysv,dbus,iproute2,openssh-server,sudo,linux-image-amd64,grub-pc,parted \
  bookworm "$MOUNT_DIR" http://deb.debian.org/debian

echo "Mounting virtual filesystems for chroot..."
mount --bind /dev "$MOUNT_DIR/dev"
mount --bind /dev/pts "$MOUNT_DIR/dev/pts"
mount -t proc proc "$MOUNT_DIR/proc"
mount -t sysfs sys "$MOUNT_DIR/sys"
mount -t tmpfs tmpfs "$MOUNT_DIR/run"

echo "Creating admin user..."
chroot "$MOUNT_DIR" useradd -m -s /bin/bash -G sudo "$VM_USER" 2>/dev/null || true
chroot "$MOUNT_DIR" sh -c "echo '${VM_USER}:${VM_USER}' | chpasswd"

echo "Running Root VM provisioning script..."
cp "$SETUP_SCRIPT" "$MOUNT_DIR/tmp/setup-root-vm.sh"
chroot "$MOUNT_DIR" bash /tmp/setup-root-vm.sh
rm -f "$MOUNT_DIR/tmp/setup-root-vm.sh"

echo "Installing fnm and Node.js as ${VM_USER}..."
chroot "$MOUNT_DIR" su - "$VM_USER" -c 'curl -fsSL https://fnm.vercel.app/install | bash'
# shellcheck disable=SC2016
chroot "$MOUNT_DIR" su - "$VM_USER" -c \
  'export PATH="$HOME/.local/share/fnm:$PATH" && eval "$(fnm env)" && fnm install --lts && npm install -g pm2'

echo "Configuring fstab..."
PART_UUID=$(blkid -s UUID -o value "$PART_DEV")
cat > "$MOUNT_DIR/etc/fstab" <<EOF
UUID=${PART_UUID}  /  ext4  errors=remount-ro  0 1
rockpool /mnt/rockpool virtiofs defaults,nofail 0 0
EOF

echo "Installing GRUB bootloader..."
LOOP_BASE=$(basename "$LOOP_DEV")
mkdir -p "$MOUNT_DIR/boot/grub"

cat > "$MOUNT_DIR/boot/grub/device.map" <<EOF
(hd0)   ${LOOP_DEV}
EOF

chroot "$MOUNT_DIR" grub-install --target=i386-pc --boot-directory=/boot "$LOOP_DEV"

cat > "$MOUNT_DIR/etc/default/grub" <<'GRUBCONF'
GRUB_DEFAULT=0
GRUB_TIMEOUT=1
GRUB_CMDLINE_LINUX_DEFAULT=""
GRUB_CMDLINE_LINUX="console=tty0 console=ttyS0,115200n8"
GRUB_TERMINAL="serial console"
GRUB_SERIAL_COMMAND="serial --speed=115200 --unit=0 --word=8 --parity=no --stop=1"
GRUBCONF

chroot "$MOUNT_DIR" update-grub

rm -f "$MOUNT_DIR/boot/grub/device.map"

echo "Final cleanup inside chroot..."
chroot "$MOUNT_DIR" apt-get clean
rm -rf "$MOUNT_DIR/var/lib/apt/lists/"*

echo "Unmounting virtual filesystems..."
umount "$MOUNT_DIR/dev/pts" || true
umount "$MOUNT_DIR/dev" || true
umount "$MOUNT_DIR/proc" || true
umount "$MOUNT_DIR/sys" || true
umount "$MOUNT_DIR/run" || true

echo "Unmounting root partition..."
umount "$MOUNT_DIR"

echo "Converting raw image to qcow2..."
qemu-img convert -f raw -O qcow2 -c "$RAW_IMAGE" "$QCOW2_IMAGE"
rm -f "$RAW_IMAGE"

losetup -d "$LOOP_DEV" 2>/dev/null || true
LOOP_DEV=""

if [ -n "${SUDO_USER:-}" ]; then
  chown "${SUDO_USER}:${SUDO_USER}" "$QCOW2_IMAGE"
  chown "${SUDO_USER}:${SUDO_USER}" "$OUTPUT_DIR"
fi

echo ""
echo "Root VM image built successfully."
echo "  Image: ${QCOW2_IMAGE}"
echo "  Size:  $(du -h "$QCOW2_IMAGE" | cut -f1)"
echo ""
echo "Start the VM with: npm run start:vm"
