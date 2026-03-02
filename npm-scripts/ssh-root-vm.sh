#!/usr/bin/env bash
set -euo pipefail

# SSH into the Rockpool Root VM using the project keypair.
# Detects the platform: on macOS uses tart ip for the VM address,
# on Linux uses localhost with port forwarding.
#
# With no arguments, opens an interactive shell.
# With arguments, executes them as a remote command.
#
# Usage:
#   npm run ssh:vm                        # interactive shell
#   npm run ssh:vm -- 'podman compose ps'  # run a command
#   npm run ssh:vm -- -t 'htop'           # run interactive command

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SSH_KEY="${ROOT_DIR}/images/root-vm/keys/rockpool-root-vm_ed25519"
PLATFORM="$(uname -s)"
TART_VM_NAME="${TART_VM_NAME:-rockpool-root}"

if [ ! -f "$SSH_KEY" ]; then
  echo "ERROR: SSH key not found at ${SSH_KEY}"
  exit 1
fi

SSH_HOST=""
SSH_PORT="22"

if [ "$PLATFORM" = "Darwin" ]; then
  if ! command -v tart &>/dev/null; then
    echo "ERROR: tart is not installed."
    exit 1
  fi
  SSH_HOST=$(tart ip "$TART_VM_NAME" 2>/dev/null || true)
  if [ -z "$SSH_HOST" ]; then
    echo "ERROR: Could not get IP for VM '${TART_VM_NAME}'."
    echo "Is the VM running? Start it with: npm run start:vm"
    exit 1
  fi
else
  SSH_HOST="localhost"
  SSH_PORT="${ROOT_VM_SSH_PORT:-2222}"
fi

exec ssh \
  -i "$SSH_KEY" \
  -p "$SSH_PORT" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR \
  "admin@${SSH_HOST}" \
  "$@"
