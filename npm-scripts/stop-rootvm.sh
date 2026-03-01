#!/usr/bin/env bash
set -euo pipefail

# Stop the Rockpool stack inside the Root VM and shut down the VM.
# Combines PM2 stop + VM shutdown into a single command.
#
# Usage:
#   npm run stop:rootvm

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SSH_SCRIPT="${SCRIPT_DIR}/ssh-root-vm.sh"
STOP_VM_SCRIPT="${SCRIPT_DIR}/stop-root-vm.sh"

usage() {
  echo "Usage: $0"
  echo ""
  echo "Stops all PM2 processes inside the Root VM, then shuts down the VM."
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

echo "=== Stopping Rockpool stack inside the VM ==="
if "$SSH_SCRIPT" 'cd /mnt/rockpool && npx pm2 delete all' 2>/dev/null; then
  echo "PM2 processes stopped."
else
  echo "Could not stop PM2 (VM may not be reachable). Proceeding with VM shutdown."
fi

echo ""
echo "=== Stopping Root VM ==="
"$STOP_VM_SCRIPT"
