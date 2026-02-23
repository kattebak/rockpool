#!/usr/bin/env bash
set -euo pipefail

# Preflight checks before starting the Rockpool control plane.
# Verifies that required tools and images are available.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export TART_HOME="${TART_HOME:-${ROOT_DIR}/.tart}"

IMAGE_NAME="rockpool-workspace"
ENV_FILE="${ROOT_DIR}/development.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: development.env not found."
  echo ""
  echo "Create it from the template:"
  echo "  make development.env"
  exit 1
fi

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

echo "Preflight checks passed."
