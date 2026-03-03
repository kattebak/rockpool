#!/usr/bin/env bash
set -euo pipefail

# Provision a Debian Bookworm system as a Rockpool Root VM.
# Runs as root: inside an mmdebstrap customize-hook (Linux/QEMU) or via tart exec (macOS/Tart).
# Supports both x86_64 and arm64 (aarch64) architectures.
# Installs: Podman, SSH server, virtiofs mount support.
# The control plane (Caddy, ElasticMQ, server, worker, client) runs as Podman Compose
# containers inside the VM -- no need to install Node.js, Java, or Caddy here.
#
# Note: fstab is NOT configured here. Each builder writes its own fstab:
#   - Linux/QEMU: build-root-vm.sh writes /dev/vda root + virtiofs via mmdebstrap hooks
#   - macOS/Tart: build-root-vm-tart.sh appends virtiofs entry via tart exec

VM_USER="admin"

apt-get update -qq
apt-get install -y -qq \
  curl \
  wget \
  jq \
  git \
  openssh-server \
  make \
  ca-certificates \
  openssl \
  htop \
  less \
  file \
  tree \
  net-tools \
  iputils-ping \
  sudo \
  podman \
  uidmap \
  slirp4netns \
  cloud-guest-utils

echo "Configuring admin user..."
if ! id "$VM_USER" &>/dev/null; then
  useradd -m -s /bin/bash -G sudo "$VM_USER"
  echo "${VM_USER}:${VM_USER}" | chpasswd
fi
echo "${VM_USER} ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/${VM_USER}"
chmod 440 "/etc/sudoers.d/${VM_USER}"

echo "Configuring SSH server..."
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/rockpool.conf <<'SSHCONF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
SSHCONF

SSH_DIR="/home/${VM_USER}/.ssh"
mkdir -p "${SSH_DIR}"
cat > "${SSH_DIR}/authorized_keys" <<'AUTHKEYS'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOCpmxFuT1c0KTSp4law/4HaqhCa0N9kTu6l/2JuPSdQ rockpool-root-vm
AUTHKEYS
chmod 700 "${SSH_DIR}"
chmod 600 "${SSH_DIR}/authorized_keys"
chown -R "${VM_USER}:${VM_USER}" "${SSH_DIR}"

systemctl enable ssh 2>/dev/null || ln -sf /lib/systemd/system/ssh.service /etc/systemd/system/multi-user.target.wants/ssh.service

echo "Setting up virtiofs mount point..."
mkdir -p /mnt/rockpool

echo "Setting up persistent state directory..."
mkdir -p /opt/rockpool

echo "Configuring hostname..."
echo "rockpool-root" > /etc/hostname

echo "Enabling serial console..."
ARCH=$(uname -m 2>/dev/null || echo "x86_64")
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  SERIAL_TTY="ttyAMA0"
else
  SERIAL_TTY="ttyS0"
fi
ln -sf /lib/systemd/system/serial-getty@.service \
  "/etc/systemd/system/getty.target.wants/serial-getty@${SERIAL_TTY}.service" 2>/dev/null || true

echo "Configuring networking (DHCP on all ethernet interfaces)..."
mkdir -p /etc/systemd/network
cat > /etc/systemd/network/80-dhcp.network <<'NETCONF'
[Match]
Name=en* eth*

[Network]
DHCP=yes
NETCONF

systemctl enable systemd-networkd 2>/dev/null || \
  ln -sf /lib/systemd/system/systemd-networkd.service /etc/systemd/system/multi-user.target.wants/systemd-networkd.service
systemctl enable systemd-resolved 2>/dev/null || \
  ln -sf /lib/systemd/system/systemd-resolved.service /etc/systemd/system/multi-user.target.wants/systemd-resolved.service

echo "Cleaning up apt cache..."
apt-get clean
rm -rf /var/lib/apt/lists/*

echo "Root VM provisioning complete."
