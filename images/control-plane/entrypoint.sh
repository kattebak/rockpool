#!/usr/bin/env bash
set -euo pipefail

/opt/elasticmq/bin/elasticmq-native-server \
  -Dconfig.file=/opt/elasticmq.conf \
  -Dlogback.configurationFile=/opt/logback.xml &

QUEUE_ENDPOINT="${QUEUE_ENDPOINT:-http://localhost:9324}"

for _ in $(seq 1 30); do
  if node -e "fetch('${QUEUE_ENDPOINT}/?Action=CreateQueue&QueueName=workspace-jobs').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  sleep 1
done

node --experimental-strip-types packages/worker/src/main.ts &

if [ -n "${SPA_PROXY_URL:-}" ]; then
  npx vite --config packages/client/vite.config.ts &
fi

exec "$@"
