#!/usr/bin/env bash
set -euo pipefail

# Preflight checks before starting the Rockpool control plane.
# Verifies that required tools and images are available.

IMAGE_NAME="rockpool-workspace"

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
  echo "  npm run build:image"
  exit 1
fi

echo "Preflight checks passed."
