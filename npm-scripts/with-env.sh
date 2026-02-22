#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENVRC="$PROJECT_ROOT/.envrc"

if [ ! -f "$ENVRC" ]; then
  echo "error: .envrc not found at $ENVRC" >&2
  echo "" >&2
  echo "Run 'make setup-envrc' to create a template, then fill in your secrets." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$ENVRC"

MISSING=()
for var in "$@"; do
  if [ "$var" = "--" ]; then
    shift
    break
  fi
  if [ -z "${!var:-}" ]; then
    MISSING+=("$var")
  fi
  shift
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "error: required environment variables not set in .envrc:" >&2
  for var in "${MISSING[@]}"; do
    echo "  - $var" >&2
  done
  echo "" >&2
  echo "See doc/EDD/003_Caddy_Reverse_Proxy.md appendix for setup instructions." >&2
  exit 1
fi

exec "$@"
