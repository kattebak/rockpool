#!/usr/bin/env bash
set -euo pipefail

# Build a Firecracker ext4 rootfs image for Rockpool workspaces.
# Requires: debootstrap, root privileges
#
# Usage: sudo build-firecracker-rootfs.sh [base-path]
#
# Produces: <base-path>/base/rockpool-workspace.ext4

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BASE_PATH="${1:-${ROOT_DIR}/.firecracker}"
ROOTFS_PATH="${BASE_PATH}/base/rockpool-workspace.ext4"
SETUP_SCRIPT="${ROOT_DIR}/images/scripts/setup.sh"
FC_DIR="${ROOT_DIR}/images/firecracker"
ROOTFS_SIZE_MB=40960

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root (sudo)."
  exit 1
fi

if ! command -v debootstrap &>/dev/null; then
  echo "ERROR: debootstrap is not installed."
  echo "Install it with: apt install debootstrap"
  exit 1
fi

if [ ! -f "$SETUP_SCRIPT" ]; then
  echo "ERROR: Setup script not found at $SETUP_SCRIPT"
  exit 1
fi

mkdir -p "$(dirname "$ROOTFS_PATH")"

echo "Creating sparse rootfs image (${ROOTFS_SIZE_MB}MB)..."
dd if=/dev/zero of="$ROOTFS_PATH" bs=1M count=0 seek=$ROOTFS_SIZE_MB 2>/dev/null
mkfs.ext4 -F -q "$ROOTFS_PATH"

MOUNT_DIR=$(mktemp -d)
mount "$ROOTFS_PATH" "$MOUNT_DIR"

cleanup() {
  echo "Cleaning up..."
  umount "$MOUNT_DIR" 2>/dev/null || true
  rmdir "$MOUNT_DIR" 2>/dev/null || true
}
trap cleanup EXIT

echo "Installing Debian bookworm via debootstrap..."
debootstrap --include=systemd,systemd-sysv,dbus,iproute2,openssh-server,sudo \
  bookworm "$MOUNT_DIR" http://deb.debian.org/debian

echo "Creating admin user..."
chroot "$MOUNT_DIR" useradd -m -s /bin/bash -G sudo admin
chroot "$MOUNT_DIR" sh -c 'echo "admin:admin" | chpasswd'
chroot "$MOUNT_DIR" sh -c 'echo "admin ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/admin'

echo "Running shared setup script..."
cp "$SETUP_SCRIPT" "$MOUNT_DIR/tmp/setup.sh"
chroot "$MOUNT_DIR" bash /tmp/setup.sh
rm "$MOUNT_DIR/tmp/setup.sh"

echo "Installing Firecracker guest network service..."
cp "${FC_DIR}/rockpool-net-setup.sh" "$MOUNT_DIR/usr/local/bin/rockpool-net-setup.sh"
chmod +x "$MOUNT_DIR/usr/local/bin/rockpool-net-setup.sh"

cp "${FC_DIR}/rockpool-net.service" "$MOUNT_DIR/etc/systemd/system/rockpool-net.service"
chroot "$MOUNT_DIR" ln -sf /etc/systemd/system/rockpool-net.service /etc/systemd/system/multi-user.target.wants/rockpool-net.service

echo "Configuring hostname..."
echo "rockpool" > "$MOUNT_DIR/etc/hostname"

echo "Configuring fstab..."
cat > "$MOUNT_DIR/etc/fstab" <<EOF
/dev/vda  /  ext4  defaults  0 1
EOF

echo "Setting up serial console for Firecracker..."
chroot "$MOUNT_DIR" ln -sf /lib/systemd/system/serial-getty@.service "/etc/systemd/system/getty.target.wants/serial-getty@ttyS0.service" 2>/dev/null || true

if [ -n "${SUDO_USER:-}" ]; then
  chown -R "$SUDO_USER:$SUDO_USER" "$BASE_PATH"
fi

echo "Rootfs built successfully at $ROOTFS_PATH"
echo "Size: $(du -h "$ROOTFS_PATH" | cut -f1)"
