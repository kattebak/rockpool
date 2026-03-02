#!/usr/bin/env bash
set -euo pipefail

# Preflight checks before starting the Rockpool control plane.
# On macOS: checks for Tart and the Root VM, boots the VM.
# On Linux: checks for Podman with compose support.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

ENV_FILE="${ROOT_DIR}/development.env"
PLATFORM="$(uname -s)"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: development.env not found."
  echo ""
  echo "Create it from the template:"
  echo "  make development.env"
  exit 1
fi

if [ "$PLATFORM" = "Darwin" ]; then
  if ! command -v tart &>/dev/null; then
    echo "ERROR: tart is not installed."
    echo "  brew install cirruslabs/cli/tart"
    exit 1
  fi

  TART_VM_NAME="${TART_VM_NAME:-rockpool-root}"
  if ! tart list 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$TART_VM_NAME"; then
    echo "ERROR: Root VM '${TART_VM_NAME}' not found."
    echo ""
    echo "Build it with:"
    echo "  make .stamps/rockpool-root-vm-tart"
    exit 1
  fi

  "${SCRIPT_DIR}/start-root-vm.sh"

elif [ "$PLATFORM" = "Linux" ]; then
  if ! command -v podman &>/dev/null; then
    echo "ERROR: podman is not installed."
    echo "  sudo apt install podman"
    exit 1
  fi

  if ! podman compose version &>/dev/null; then
    echo "ERROR: podman compose is not available."
    echo "  Install podman-compose or upgrade podman to 4.x+:"
    echo "  sudo apt install podman-compose"
    exit 1
  fi
else
  echo "WARNING: Unsupported platform: $PLATFORM"
fi

echo "Preflight checks passed."
