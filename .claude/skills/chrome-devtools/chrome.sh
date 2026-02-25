#!/usr/bin/env bash
set -euo pipefail

# Chrome DevTools wrapper — launches Chrome or runs CDP commands.
#
# Usage:
#   chrome.sh launch              Launch Chrome with remote debugging
#   chrome.sh <command> [args...]  Run a CDP command (list, navigate, screenshot, eval, reload, version)

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ $# -eq 0 ]; then
  echo "Usage:"
  echo "  chrome.sh launch              Launch Chrome with remote debugging"
  echo "  chrome.sh <command> [args...]  Run a CDP command (list, navigate, screenshot, eval, reload, version)"
  exit 1
fi

COMMAND="$1"
shift

if [ "$COMMAND" = "launch" ]; then
  PORT="${1:-9222}"
  USER_DATA_DIR="${HOME}/.chrome-devtools-mcp"

  if [[ "$OSTYPE" == "darwin"* ]]; then
    CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if [[ ! -f "$CHROME_PATH" ]]; then
      echo "Error: Chrome not found at $CHROME_PATH"
      exit 1
    fi
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    CHROME_PATH=$(which google-chrome || which chromium-browser || which chromium || echo "")
    if [[ -z "$CHROME_PATH" ]]; then
      echo "Error: Chrome/Chromium not found"
      exit 1
    fi
  else
    echo "Error: Unsupported OS: $OSTYPE"
    exit 1
  fi

  if lsof -i ":$PORT" > /dev/null 2>&1; then
    echo "Port $PORT already in use — Chrome DevTools may already be running."
    echo "Connect at: http://localhost:$PORT"
    exit 0
  fi

  echo "Starting Chrome with remote debugging on port $PORT..."
  exec "$CHROME_PATH" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$USER_DATA_DIR" \
    --no-first-run \
    --no-default-browser-check \
    --disable-session-crashed-bubble \
    --disable-infobars \
    "about:blank"
fi

exec node --experimental-websocket "$SKILL_DIR/chrome-cdp.mjs" "$COMMAND" "$@"
