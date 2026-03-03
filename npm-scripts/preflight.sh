#!/usr/bin/env bash
set -euo pipefail

# Preflight checks before starting the Rockpool control plane.
# Checks for Podman with compose support on both macOS and Linux.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

ENV_FILE="${ROOT_DIR}/development.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: development.env not found."
  echo ""
  echo "Create it from the template:"
  echo "  make development.env"
  exit 1
fi

if ! command -v podman &>/dev/null; then
  echo "ERROR: podman is not installed."
  echo "  See https://podman.io/docs/installation"
  exit 1
fi

if ! podman compose version &>/dev/null; then
  echo "ERROR: podman compose is not available."
  echo "  Install podman-compose or upgrade podman to 4.x+:"
  echo "  sudo apt install podman-compose"
  exit 1
fi

echo "Preflight checks passed."
