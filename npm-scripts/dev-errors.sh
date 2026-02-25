#!/usr/bin/env bash
set -euo pipefail

# Extract error/warn-level log lines from PM2 structured logs.
# Usage: npm run dev:errors [-- --lines N] [-- --process NAME]

LINES=200
PROCESS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lines) LINES="$2"; shift 2 ;;
    --process) PROCESS="$2"; shift 2 ;;
    *) echo "Usage: $0 [--lines N] [--process NAME]" >&2; exit 1 ;;
  esac
done

PM2_LOG_DIR="${HOME}/.pm2/logs"

if [[ -n "$PROCESS" ]]; then
  files=("${PM2_LOG_DIR}/${PROCESS}-out.log" "${PM2_LOG_DIR}/${PROCESS}-error.log")
else
  files=("${PM2_LOG_DIR}"/*-out.log "${PM2_LOG_DIR}"/*-error.log)
fi

output=$(
  for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue
    tail -n "$LINES" "$f"
  done | jq -c 'select(.level >= 40)' 2>/dev/null
) || true

if [[ -z "$output" ]]; then
  echo "No errors or warnings found (last $LINES lines per log file)"
  exit 0
fi

echo "$output" | jq .
