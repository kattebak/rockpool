#!/usr/bin/env bash
set -euo pipefail

# Start the Rockpool stack via Podman Compose.
# On macOS: runs compose inside the Root VM via SSH.
# On Linux: runs compose locally.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLATFORM="$(uname -s)"

if [ "$PLATFORM" = "Darwin" ]; then
  SSH_SCRIPT="${SCRIPT_DIR}/ssh-root-vm.sh"
  "$SSH_SCRIPT" "cd /mnt/rockpool && podman compose -f compose.yaml up -d"
  exec "$SSH_SCRIPT" "cd /mnt/rockpool && podman compose logs -f"
else
  "${SCRIPT_DIR}/podman.sh" development.env up
fi
