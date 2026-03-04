#!/usr/bin/env bash
set -euo pipefail

node --experimental-strip-types packages/worker/src/main.ts &

if [ -n "${SPA_PROXY_URL:-}" ]; then
  npx vite --config packages/client/vite.config.ts &
fi

watch_flag=""
if [ "${NODE_WATCH:-}" = "1" ]; then
  watch_flag="--watch"
fi

# shellcheck disable=SC2086
exec node $watch_flag --experimental-strip-types packages/server/src/index.ts
