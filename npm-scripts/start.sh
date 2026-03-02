#!/usr/bin/env bash
set -euo pipefail

# Start the Rockpool stack.
# On macOS: runs PM2 inside the Root VM via SSH.
# On Linux: runs PM2 locally.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLATFORM="$(uname -s)"

if [ "$PLATFORM" = "Darwin" ]; then
  SSH_SCRIPT="${SCRIPT_DIR}/ssh-root-vm.sh"
  "$SSH_SCRIPT" 'cd /mnt/rockpool && npx pm2 delete all --silent; npx pm2 start ecosystem.rootvm.config.cjs'
  exec "$SSH_SCRIPT" 'cd /mnt/rockpool && npx pm2 logs'
else
  pm2 delete all --silent
  pm2 start "${ROOT_DIR}/ecosystem.caddy.config.cjs"
  pm2 logs
fi
