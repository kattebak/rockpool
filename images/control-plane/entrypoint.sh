#!/usr/bin/env bash
set -euo pipefail

node --experimental-strip-types packages/worker/src/main.ts &

if [ -n "${SPA_PROXY_URL:-}" ]; then
  npx vite --config packages/client/vite.config.ts &
fi

exec "$@"
