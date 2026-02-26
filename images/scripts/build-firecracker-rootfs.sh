#!/usr/bin/env bash
set -euo pipefail

ROOTFS_SIZE_MB=20480
ROOTFS_PATH=".firecracker/base/rockpool-workspace.ext4"
SETUP_SCRIPT="images/scripts/setup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

mkdir -p .firecracker/base

# Create sparse file (doesn't actually allocate all space)
dd if=/dev/zero of="$ROOTFS_PATH" bs=1M count=0 seek=$ROOTFS_SIZE_MB
mkfs.ext4 -F "$ROOTFS_PATH"

MOUNT_DIR=$(mktemp -d)
sudo mount "$ROOTFS_PATH" "$MOUNT_DIR"

# Install Debian minimal
sudo debootstrap --include=systemd,systemd-sysv,dbus,iproute2,openssh-server,curl,jq,make \
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
