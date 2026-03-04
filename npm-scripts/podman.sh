#!/usr/bin/env bash
set -euo pipefail

# Wrapper for podman compose that derives compose files from a given env file.
# Detects Linux and layers compose.linux.yaml automatically.
#
# Usage: podman.sh <env-file> <compose-subcommand> [args...]
#
# The env file name determines which compose overlay to use via naming convention:
#
#   development.env → compose.development.yaml
#   test.env        → compose.test.yaml
#
# Examples:
#   podman.sh development.env up -d
#   podman.sh test.env logs --tail 50

if [ $# -lt 2 ]; then
  echo "Usage: podman.sh <env-file> <compose-subcommand> [args...]"
  echo ""
  echo "Examples:"
  echo "  podman.sh development.env up -d"
  echo "  podman.sh test.env logs --tail 50"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

ENV_FILE="$1"
shift

PROFILE="${ENV_FILE%.env}"

export ENV_FILE

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
