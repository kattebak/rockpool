#!/usr/bin/env bash
set -euo pipefail

# Stop the Rockpool stack via Podman Compose.
# On macOS: stops compose inside the Root VM via SSH.
# On Linux: stops compose locally.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM="$(uname -s)"

if [ "$PLATFORM" = "Darwin" ]; then
  "${SCRIPT_DIR}/root-vm.sh" down || true
else
  "${SCRIPT_DIR}/podman.sh" development.env down
fi
