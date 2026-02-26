#!/usr/bin/env bash
set -euo pipefail

# Linux host setup for Rockpool (Firecracker runtime).
# Installs system dependencies, sets up networking, downloads Firecracker,
# and configures sudoers for unprivileged VM management.
#
# Usage: sudo npm-scripts/linux-setup.sh
#
# This script is idempotent — safe to run multiple times.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ "$(uname -s)" != "Linux" ]; then
  echo "ERROR: This script is for Linux only."
  echo "On macOS, use Homebrew: brew install cirruslabs/cli/tart"
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root (sudo)."
  echo "Usage: sudo $0"
  exit 1
fi

REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo "")}"

if [ -z "$REAL_USER" ]; then
  echo "ERROR: Could not determine the non-root user."
  echo "Run this script with sudo, not as root directly."
  exit 1
fi

echo "=== Rockpool Linux Setup ==="
echo "Host user: $REAL_USER"
echo ""

# --- Step 1: System dependencies ---
echo "--- Installing system dependencies ---"
apt-get update -qq

DEPS=(
  build-essential
  python3
  default-jre-headless
  debootstrap
  jq
  curl
  iptables
  iproute2
)

apt-get install -y -qq "${DEPS[@]}"
echo "System dependencies installed."
echo ""

# --- Step 2: Caddy ---
if command -v caddy &>/dev/null; then
  echo "--- Caddy already installed, skipping ---"
else
  echo "--- Installing Caddy ---"
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
  echo "Caddy installed."
fi

systemctl stop caddy 2>/dev/null || true
systemctl disable caddy 2>/dev/null || true
echo "Caddy system service disabled (Rockpool manages Caddy directly)."
echo ""

# --- Step 3: KVM access ---
echo "--- Configuring KVM access ---"
if [ ! -e /dev/kvm ]; then
  echo "WARNING: /dev/kvm not found. Nested virtualization may not be enabled."
  echo "If running in a VM, enable nested virt on the host."
else
  if ! groups "$REAL_USER" | grep -qw kvm; then
    usermod -aG kvm "$REAL_USER"
    echo "Added $REAL_USER to kvm group (log out and back in to take effect)."
  else
    echo "$REAL_USER already in kvm group."
  fi
fi
echo ""

# --- Step 4: Network bridge ---
echo "--- Setting up network bridge ---"
"${ROOT_DIR}/npm-scripts/firecracker-bridge-setup.sh"
echo ""

# --- Step 5: Download Firecracker (unprivileged) ---
# Run as the real user so .firecracker/ is owned correctly.
# Must happen before rootfs build so the directory exists with user ownership.
echo "--- Downloading Firecracker ---"
sudo -u "$REAL_USER" "${ROOT_DIR}/npm-scripts/firecracker-setup.sh"
echo ""

# --- Step 6: Build rootfs ---
FC_BASE_PATH="${ROOT_DIR}/.firecracker"

if [ -f "${FC_BASE_PATH}/base/rockpool-workspace.ext4" ]; then
  echo "--- Rootfs already exists, skipping build ---"
  echo "To rebuild: sudo images/scripts/build-firecracker-rootfs.sh"
else
  echo "--- Building Firecracker rootfs (this takes a while) ---"
  "${ROOT_DIR}/images/scripts/build-firecracker-rootfs.sh"
fi
echo ""

# --- Step 7: Sudoers ---
echo "--- Configuring sudoers ---"
SUDOERS_FILE="/etc/sudoers.d/rockpool"
FC_BIN="${FC_BASE_PATH}/bin/firecracker"
NET_SCRIPT="${ROOT_DIR}/npm-scripts/firecracker-net.sh"

SUDOERS_LINE="${REAL_USER} ALL=(root) NOPASSWD: ${NET_SCRIPT}, /usr/bin/firecracker, ${FC_BIN}"

echo "$SUDOERS_LINE" > "$SUDOERS_FILE"
chmod 0440 "$SUDOERS_FILE"
echo "Sudoers configured at $SUDOERS_FILE"
echo ""

# --- Step 8: development.env ---
DEV_ENV="${ROOT_DIR}/development.env"

if [ ! -f "$DEV_ENV" ]; then
  sudo -u "$REAL_USER" cp "${ROOT_DIR}/development.env.example" "$DEV_ENV"
  sed -i 's/^RUNTIME=tart$/RUNTIME=firecracker/' "$DEV_ENV"
  sed -i 's/^# FIRECRACKER_BASE_PATH/FIRECRACKER_BASE_PATH/' "$DEV_ENV"
  echo "Created development.env with RUNTIME=firecracker"
else
  echo "development.env already exists, not overwriting."
  echo "Ensure RUNTIME=firecracker is set for Linux."
fi
echo ""

echo "=== Setup complete ==="
echo ""
echo "Remaining steps (run as $REAL_USER):"
echo "  npm install"
echo "  npx playwright install chromium"
echo "  npm run dev"
echo ""
echo "If you just got added to the kvm group, log out and back in first."
