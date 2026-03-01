#!/usr/bin/env bash
set -euo pipefail

# Start the Root VM and boot the full Rockpool stack inside it.
# Combines VM boot + SSH + PM2 start into a single command.
#
# Usage:
#   npm run start:rootvm

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
START_VM_SCRIPT="${SCRIPT_DIR}/start-root-vm.sh"
SSH_SCRIPT="${SCRIPT_DIR}/ssh-root-vm.sh"

usage() {
  echo "Usage: $0"
  echo ""
  echo "Starts the Root VM (if not already running) and boots the"
  echo "full Rockpool stack inside it using PM2."
  echo ""
  echo "The stack includes: Caddy, server, worker, ElasticMQ, client dev server."
  echo "Workspaces run as Podman rootless containers inside the VM."
  echo ""
  echo "After starting, the dashboard is available at http://localhost:8080/app/workspaces"
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

echo "=== Starting Root VM ==="
"$START_VM_SCRIPT"

echo ""
echo "=== Starting Rockpool stack inside the VM ==="
"$SSH_SCRIPT" 'cd /mnt/rockpool && npx pm2 delete all --silent; npx pm2 start ecosystem.rootvm.config.cjs'

echo ""
echo "Waiting for services to come up..."
sleep 3
"$SSH_SCRIPT" 'cd /mnt/rockpool && npx pm2 status'

echo ""
echo "Rockpool Root VM stack is running."
echo ""
echo "  Dashboard: http://localhost:8080/app/workspaces"
echo "  Logs:      npm run vm:logs"
echo "  SSH:       npm run ssh:vm"
echo "  Stop:      npm run stop:rootvm"
echo ""
