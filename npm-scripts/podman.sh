#!/usr/bin/env bash
set -euo pipefail

# Wrapper for podman compose that derives compose files and env vars from
# a given env file. Detects Linux and layers compose.linux.yaml automatically.
#
# Usage: podman.sh <env-file> <compose-subcommand> [args...]
#
# The env file name determines which compose overlay and elasticmq config
# to use via naming convention:
#
#   development.env → compose.development.yaml, elasticmq.conf
#   test.env        → compose.test.yaml,        elasticmq.test.conf
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
PROFILE_CONF="elasticmq.${PROFILE}.conf"
if [ -f "${ROOT_DIR}/${PROFILE_CONF}" ]; then
  export ELASTICMQ_CONF="${ELASTICMQ_CONF:-${PROFILE_CONF}}"
else
  export ELASTICMQ_CONF="${ELASTICMQ_CONF:-elasticmq.conf}"
fi

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
