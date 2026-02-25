#!/usr/bin/env bash
set -euo pipefail

# Setup script for Debian-based Rockpool workspace VM (tart / arm64)
# Base image: ghcr.io/cirruslabs/debian:latest
# Init system: systemd, code-server runs as code-server@admin

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

CS_USER="admin"

$SUDO apt-get update -qq
$SUDO apt-get install -y -qq \
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

$SUDO systemctl enable ssh
$SUDO systemctl start ssh || true

$SUDO -u "${CS_USER}" bash -c 'curl -fsSL https://fnm.vercel.app/install | bash'
# shellcheck disable=SC2016
$SUDO -u "${CS_USER}" bash -c 'export PATH="/home/admin/.local/share/fnm:$PATH" && eval "$(fnm env)" && fnm install --lts'

$SUDO mkdir -p "/home/${CS_USER}/workspace"
$SUDO chown -R "${CS_USER}:${CS_USER}" "/home/${CS_USER}"

if ! command -v code-server >/dev/null 2>&1; then
  curl -fsSL https://code-server.dev/install.sh | $SUDO sh
fi

$SUDO mkdir -p "/home/${CS_USER}/.config/code-server"

$SUDO tee "/home/${CS_USER}/.config/code-server/config.yaml" >/dev/null <<EOF
bind-addr: 0.0.0.0:8080
auth: none
cert: false
abs-proxy-base-path: /workspace/default
EOF

$SUDO chown -R "${CS_USER}:${CS_USER}" "/home/${CS_USER}/.config"

$SUDO systemctl enable "code-server@${CS_USER}"
$SUDO systemctl start "code-server@${CS_USER}" || true

SSH_DIR="/home/${CS_USER}/.ssh"
$SUDO mkdir -p "${SSH_DIR}"
$SUDO tee "${SSH_DIR}/authorized_keys" >/dev/null <<'SSHEOF'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIILyJJWuMlRsALg5KCdsm8rV+ZK01umDcac7k9Gv4xFs rockpool-vm-access
SSHEOF
$SUDO chmod 700 "${SSH_DIR}"
$SUDO chmod 600 "${SSH_DIR}/authorized_keys"
$SUDO chown -R "${CS_USER}:${CS_USER}" "${SSH_DIR}"
