#!/bin/bash
# Launch Chrome with remote debugging enabled for Chrome DevTools MCP
#
# Usage: npm run chrome:debug [-- port]
#   port: Remote debugging port (default: 9222)
#
# Uses a separate user profile to avoid affecting your main Chrome.

set -e

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
    echo "MCP server will connect at: http://localhost:$PORT"
    exit 0
fi

echo "Starting Chrome with remote debugging on port $PORT..."
echo "User data directory: $USER_DATA_DIR"
echo "Keep this window open while using the DevTools MCP."

"$CHROME_PATH" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$USER_DATA_DIR" \
    --no-first-run \
    --no-default-browser-check \
    --disable-session-crashed-bubble \
    --disable-infobars \
    "about:blank"
