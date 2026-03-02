#!/usr/bin/env bash
set -euo pipefail

# Stop the Rockpool stack.
# On macOS: stops PM2 inside the Root VM via SSH.
# On Linux: stops PM2 locally.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM="$(uname -s)"

if [ "$PLATFORM" = "Darwin" ]; then
  "${SCRIPT_DIR}/ssh-root-vm.sh" 'cd /mnt/rockpool && npx pm2 delete all' || true
else
  pm2 delete all
fi
