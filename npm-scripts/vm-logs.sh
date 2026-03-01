#!/usr/bin/env bash
set -euo pipefail

# View PM2 logs from inside the Rockpool Root VM.
# Passes all arguments through to pm2 logs.
#
# Usage:
#   npm run vm:logs                        # follow all logs
#   npm run vm:logs -- --lines 50          # last 50 lines
#   npm run vm:logs -- --nostream          # dump and exit

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SSH_SCRIPT="${SCRIPT_DIR}/ssh-root-vm.sh"

PM2_ARGS="${*:---lines 50}"

exec "$SSH_SCRIPT" "cd /mnt/rockpool && npm run dev:logs -- ${PM2_ARGS}"
