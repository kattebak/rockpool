#!/usr/bin/env bash
set -euo pipefail

# Stop the Rockpool stack via Podman Compose.
# On macOS: stops compose inside the Root VM via SSH.
# On Linux: stops compose locally.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLATFORM="$(uname -s)"

if [ "$PLATFORM" = "Darwin" ]; then
  "${SCRIPT_DIR}/ssh-root-vm.sh" "cd /mnt/rockpool && podman compose down" || true
else
  cd "$ROOT_DIR"
  podman compose down
fi
