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

run_as_user() {
  local user="$1"
  shift
  if [ "$(id -u)" -ne 0 ]; then
    sudo -u "$user" "$@"
  else
    su - "$user" -c "$*"
  fi
}

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

run_as_user "${CS_USER}" 'curl -fsSL https://fnm.vercel.app/install | bash'
# shellcheck disable=SC2016
run_as_user "${CS_USER}" 'export PATH="/home/admin/.local/share/fnm:$PATH" && eval "$(fnm env)" && fnm install --lts'

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

if pidof systemd >/dev/null 2>&1; then
  $SUDO systemctl enable "code-server@${CS_USER}"
  $SUDO systemctl start "code-server@${CS_USER}" || true
else
  $SUDO ln -sf /lib/systemd/system/code-server@.service "/etc/systemd/system/multi-user.target.wants/code-server@${CS_USER}.service" 2>/dev/null || true
fi

SSH_DIR="/home/${CS_USER}/.ssh"
$SUDO mkdir -p "${SSH_DIR}"
$SUDO tee "${SSH_DIR}/authorized_keys" >/dev/null <<'SSHEOF'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINPrneyLn0n1tgVxJu8BuOXn7Lvj9kHKursFR4+Gr8VE rockpool-vm-access
SSHEOF
$SUDO chmod 700 "${SSH_DIR}"
$SUDO chmod 600 "${SSH_DIR}/authorized_keys"
$SUDO chown -R "${CS_USER}:${CS_USER}" "${SSH_DIR}"
