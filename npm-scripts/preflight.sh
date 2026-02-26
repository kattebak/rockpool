#!/usr/bin/env bash
set -euo pipefail

# Preflight checks before starting the Rockpool control plane.
# Verifies that required tools and images are available.
# Supports both macOS (Tart) and Linux (Firecracker).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

IMAGE_NAME="rockpool-workspace"
ENV_FILE="${ROOT_DIR}/development.env"
PLATFORM="$(uname -s)"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: development.env not found."
  echo ""
  echo "Create it from the template:"
  echo "  make development.env"
  exit 1
fi

if ! command -v java &>/dev/null; then
  echo "ERROR: java is not installed."
  echo ""
  echo "ElasticMQ requires a Java Runtime Environment (JRE)."
  if [ "$PLATFORM" = "Darwin" ]; then
    echo "Install Java via Homebrew:"
    echo "  brew install openjdk"
  else
    echo "Install Java:"
    echo "  sudo apt install default-jre-headless"
  fi
  exit 1
fi

if [ "$PLATFORM" = "Darwin" ]; then
  # macOS: check for Tart
  export TART_HOME="${TART_HOME:-${ROOT_DIR}/.tart}"

  if ! command -v tart &>/dev/null; then
    echo "ERROR: tart is not installed."
    echo ""
    echo "Install tart via Homebrew:"
    echo "  brew install cirruslabs/cli/tart"
    exit 1
  fi

  if ! tart list 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$IMAGE_NAME"; then
    echo "ERROR: $IMAGE_NAME image not found."
    echo ""
    echo "Build the workspace image first:"
    echo "  make .stamps/rockpool-workspace"
    exit 1
  fi
elif [ "$PLATFORM" = "Linux" ]; then
  # Linux: check for Firecracker, KVM, and bridge
  FC_BASE_PATH="${FIRECRACKER_BASE_PATH:-${ROOT_DIR}/.firecracker}"

  if ! command -v firecracker &>/dev/null && [ ! -f "${FC_BASE_PATH}/bin/firecracker" ]; then
    echo "ERROR: firecracker is not installed."
    echo ""
    echo "Run the setup script to download it:"
    echo "  npm-scripts/firecracker-setup.sh"
    exit 1
  fi

  if [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then
    echo "ERROR: /dev/kvm is not accessible."
    echo ""
    echo "Ensure KVM is available and your user has access:"
    echo "  sudo usermod -aG kvm \$USER"
    echo "  (log out and back in)"
    exit 1
  fi

  if ! ip link show rockpool0 &>/dev/null; then
    echo "ERROR: rockpool0 bridge not found."
    echo ""
    echo "Set up the network bridge:"
    echo "  sudo npm-scripts/firecracker-bridge-setup.sh"
    exit 1
  fi

  if [ ! -f "${FC_BASE_PATH}/kernel/vmlinux" ]; then
    echo "ERROR: Firecracker kernel not found."
    echo ""
    echo "Run the setup script to download it:"
    echo "  npm-scripts/firecracker-setup.sh"
    exit 1
  fi

  if [ ! -f "${FC_BASE_PATH}/base/rockpool-workspace.ext4" ]; then
    echo "ERROR: Firecracker rootfs image not found."
    echo ""
    echo "Build the rootfs image:"
    echo "  sudo images/scripts/build-firecracker-rootfs.sh"
    exit 1
  fi
else
  echo "WARNING: Unsupported platform: $PLATFORM"
  echo "Rockpool supports macOS (Tart) and Linux (Firecracker)."
fi

echo "Preflight checks passed."
