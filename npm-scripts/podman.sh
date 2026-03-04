#!/usr/bin/env bash
set -euo pipefail

# Wrapper for podman compose that derives compose overlay files from a profile name.
# Detects Linux and layers compose.linux.yaml automatically.
#
# Usage: podman.sh <profile> <compose-subcommand> [args...]
#
# The profile name determines which compose overlay to use:
#
#   development → compose.development.yaml
#   test        → compose.test.yaml
#
# Examples:
#   podman.sh development up -d
#   podman.sh test logs --tail 50

if [ $# -lt 2 ]; then
  echo "Usage: podman.sh <profile> <compose-subcommand> [args...]"
  echo ""
  echo "Examples:"
  echo "  podman.sh development up -d"
  echo "  podman.sh test logs --tail 50"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PROFILE="$1"
shift

FILES=(-f compose.yaml)

OVERLAY="compose.${PROFILE}.yaml"
if [ -f "${ROOT_DIR}/${OVERLAY}" ]; then
  FILES+=(-f "$OVERLAY")
fi

if [ "$(uname -s)" = "Linux" ]; then
  FILES+=(-f compose.linux.yaml)
fi

cd "$ROOT_DIR"
exec podman compose "${FILES[@]}" "$@"
