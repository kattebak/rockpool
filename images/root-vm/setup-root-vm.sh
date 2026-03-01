#!/usr/bin/env bash
set -euo pipefail

# Provision a Debian Bookworm system as a Rockpool Root VM.
# Runs as root inside a chroot during image build.
# Installs: Node.js (fnm), PM2, Caddy, ElasticMQ, SSH server, virtiofs mount.

VM_USER="admin"
ELASTICMQ_VERSION="1.6.16"
ELASTICMQ_URL="https://s3-eu-west-1.amazonaws.com/softwaremill-public/elasticmq-server-${ELASTICMQ_VERSION}.jar"
NODE_MAJOR="22"

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
  man-db \
  net-tools \
  dnsutils \
  iputils-ping \
  socat \
  build-essential \
  python3 \
  python3-pip \
  python3-venv \
  vim \
  tmux \
  unzip \
  zip \
  rsync \
  strace \
  sudo \
  acl \
  default-jre-headless \
  podman \
  uidmap \
  slirp4netns

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

echo "Installing Caddy..."
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy
systemctl disable caddy 2>/dev/null || true

echo "Installing ElasticMQ..."
mkdir -p /opt/elasticmq
curl -L -o /opt/elasticmq/elasticmq-server.jar "$ELASTICMQ_URL"

echo "Setting up virtiofs mount point..."
mkdir -p /mnt/rockpool

if ! grep -q '/mnt/rockpool' /etc/fstab; then
  echo "rockpool /mnt/rockpool virtiofs defaults,nofail 0 0" >> /etc/fstab
fi

echo "Setting up persistent state directory..."
mkdir -p /opt/rockpool

echo "Configuring hostname..."
echo "rockpool-root" > /etc/hostname

echo "Enabling serial console..."
ln -sf /lib/systemd/system/serial-getty@.service \
  /etc/systemd/system/getty.target.wants/serial-getty@ttyS0.service 2>/dev/null || true

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
