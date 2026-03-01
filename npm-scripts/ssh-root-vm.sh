#!/usr/bin/env bash
set -euo pipefail

# SSH into the Rockpool Root VM using the project keypair.
# With no arguments, opens an interactive shell.
# With arguments, executes them as a remote command.
#
# Usage:
#   npm run ssh:vm                        # interactive shell
#   npm run ssh:vm -- 'pm2 status'        # run a command
#   npm run ssh:vm -- -t 'htop'           # run interactive command

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SSH_KEY="${ROOT_DIR}/images/root-vm/keys/rockpool-root-vm_ed25519"
SSH_PORT="${ROOT_VM_SSH_PORT:-2222}"

if [ ! -f "$SSH_KEY" ]; then
  echo "ERROR: SSH key not found at ${SSH_KEY}"
  exit 1
fi

exec ssh \
  -i "$SSH_KEY" \
  -p "$SSH_PORT" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR \
  admin@localhost \
  "$@"
