#!/usr/bin/env bash
set -euo pipefail

# View compose logs from inside the Rockpool Root VM.
# Passes all arguments through to podman compose logs.
#
# Usage:
#   npm run vm:logs                        # follow all logs
#   npm run vm:logs -- --tail 50           # last 50 lines
#   npm run vm:logs -- --no-follow         # dump and exit

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH_SCRIPT="${SCRIPT_DIR}/ssh-root-vm.sh"

COMPOSE_ARGS="${*:---follow}"

exec "$SSH_SCRIPT" "cd /mnt/rockpool && podman compose logs ${COMPOSE_ARGS}"
