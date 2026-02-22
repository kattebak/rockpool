#!/usr/bin/env bash
set -euo pipefail

# Starts the full Tidepool stack with Caddy reverse proxy on localhost.
#
# Components:
#   - Caddy (ports 8080/8081, admin API on 2019)
#   - API server (port 7163) with in-process worker
#   - Caddy bootstrapped with API proxy + SPA file server
#
# The SPA is served by Caddy from build/client/ (built before startup).
# Browse to http://localhost:8080/app/workspaces to use the app.
#
# Environment variables:
#   RUNTIME=tart        Use real Tart VMs instead of stub runtime
#   CADDY_USERNAME=...  Enable basic auth (requires CADDY_PASSWORD too)
#   CADDY_PASSWORD=...  Password for basic auth
#   LOG_LEVEL=debug     Set log level (default: info)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v caddy &>/dev/null; then
  echo "Error: caddy is not installed. Install with: brew install caddy"
  exit 1
fi

export SPA_ROOT="$PROJECT_ROOT/build/client"
export SSH_KEY_PATH="$PROJECT_ROOT/images/ssh/tidepool_ed25519"
export WORKER_INLINE=true

echo "Building client SPA..."
npm run build -w packages/client

if [ ! -f "$SPA_ROOT/index.html" ]; then
  echo "Error: SPA build output not found at $SPA_ROOT/index.html"
  exit 1
fi

PIDS=()

cleanup() {
  echo ""
  echo "Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  caddy stop 2>/dev/null || true
  wait 2>/dev/null
  echo "Done."
}

trap cleanup EXIT INT TERM

echo "Stopping any existing Caddy..."
caddy stop 2>/dev/null || true

echo "Starting Caddy..."
caddy start --config "" --adapter "" 2>/dev/null || true

echo "Starting API server on :7163 with Caddy bootstrap..."
npm run start -w packages/server &
PIDS+=($!)

echo "Waiting for API server..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:7163/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -sf http://localhost:7163/api/health >/dev/null 2>&1; then
  echo "Error: API server did not start within 15 seconds"
  exit 1
fi

echo ""
echo "Tidepool is running:"
echo "  App:   http://localhost:8080/app/workspaces"
echo "  API:   http://localhost:8080/api/health"
echo "  Admin: http://localhost:2019"
echo ""

wait
