#!/usr/bin/env bash
set -euo pipefail

# Wrapper for podman compose.
# Detects Linux and sets PODMAN_SOCKET automatically.
#
# Usage: podman.sh <compose-subcommand> [args...]
#
# Examples:
#   podman.sh up -d
#   podman.sh logs --tail 50
#   podman.sh down

if [ $# -lt 1 ]; then
  echo "Usage: podman.sh <compose-subcommand> [args...]"
  echo ""
  echo "Examples:"
  echo "  podman.sh up -d"
  echo "  podman.sh logs --tail 50"
  echo "  podman.sh down"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ "$(uname -s)" = "Linux" ]; then
  export PODMAN_SOCKET="${XDG_RUNTIME_DIR}/podman/podman.sock"
fi

cd "$ROOT_DIR"
exec podman compose "$@"
