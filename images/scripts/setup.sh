#!/usr/bin/env bash
set -euo pipefail

# Shared workspace setup — runs as root (chroot or sudo)
# Installs packages, code-server, SSH keys, and configures systemd.
# Caller is responsible for running fnm/node install as the workspace user.

CS_USER="admin"

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
  strace

mkdir -p "/home/${CS_USER}/workspace"
chown -R "${CS_USER}:${CS_USER}" "/home/${CS_USER}"

if ! command -v code-server >/dev/null 2>&1; then
  curl -fsSL https://code-server.dev/install.sh | sh
fi

mkdir -p "/home/${CS_USER}/.config/code-server"

tee "/home/${CS_USER}/.config/code-server/config.yaml" >/dev/null <<EOF
bind-addr: 0.0.0.0:8080
auth: none
cert: false
abs-proxy-base-path: /workspace/default
EOF

chown -R "${CS_USER}:${CS_USER}" "/home/${CS_USER}/.config"

if pidof systemd >/dev/null 2>&1; then
  systemctl enable "code-server@${CS_USER}"
  systemctl start "code-server@${CS_USER}" || true
else
  ln -sf /lib/systemd/system/code-server@.service "/etc/systemd/system/multi-user.target.wants/code-server@${CS_USER}.service" 2>/dev/null || true
fi

SSH_DIR="/home/${CS_USER}/.ssh"
mkdir -p "${SSH_DIR}"
tee "${SSH_DIR}/authorized_keys" >/dev/null <<'SSHEOF'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINPrneyLn0n1tgVxJu8BuOXn7Lvj9kHKursFR4+Gr8VE rockpool-vm-access
SSHEOF
chmod 700 "${SSH_DIR}"
chmod 600 "${SSH_DIR}/authorized_keys"
chown -R "${CS_USER}:${CS_USER}" "${SSH_DIR}"
