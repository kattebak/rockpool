#!/usr/bin/env bash
set -euo pipefail

/opt/elasticmq/bin/elasticmq-native-server \
  -Dconfig.file=/opt/elasticmq.conf \
  -Dlogback.configurationFile=/opt/logback.xml &

node --experimental-strip-types packages/worker/src/main.ts &

if [ -n "${SPA_PROXY_URL:-}" ]; then
  npx vite --config packages/client/vite.config.ts &
fi

exec "$@"
