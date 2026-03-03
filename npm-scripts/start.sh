#!/usr/bin/env bash
set -euo pipefail

# Start the Rockpool stack via Podman Compose.
# On macOS: runs compose inside the Root VM via SSH.
# On Linux: runs compose locally.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM="$(uname -s)"

if [ "$PLATFORM" = "Darwin" ]; then
  VM_SCRIPT="${SCRIPT_DIR}/root-vm.sh"
  "$VM_SCRIPT" up
  exec "$VM_SCRIPT" logs
else
  "${SCRIPT_DIR}/podman.sh" development.env up
fi
