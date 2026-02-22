#!/usr/bin/env bash
set -euo pipefail

# Starts API server (port 7163) and client dev server (port 5173) concurrently.
# API server runs with NODE_ENV=test (in-memory queue, stub VMs).
# Worker poll loop runs in-process with the server (shared MemoryQueue).
# Client dev server proxies /api/* to the API server.
#
# Set RUNTIME=tart to use real Tart VMs instead of the stub runtime.

PIDS=()

cleanup() {
	for pid in "${PIDS[@]}"; do
		kill "$pid" 2>/dev/null || true
	done
	wait 2>/dev/null
}

trap cleanup EXIT INT TERM

echo "Starting API server on :7163 ..."
NODE_ENV=test npm run start -w packages/server &
PIDS+=($!)

echo "Starting client dev server on :5173 ..."
npm run dev -w packages/client &
PIDS+=($!)

wait
