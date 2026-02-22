#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 -n <workspace_name> -i <vm_ip> [-a <admin_url>]"
  echo "Example: $0 -n test -i 192.168.64.5"
}

ADMIN_URL="http://localhost:2019"
WORKSPACE_NAME=""
VM_IP=""

while getopts ":n:i:a:h" opt; do
  case "$opt" in
    n) WORKSPACE_NAME="$OPTARG" ;;
    i) VM_IP="$OPTARG" ;;
    a) ADMIN_URL="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

if [ -z "$WORKSPACE_NAME" ] || [ -z "$VM_IP" ]; then
  usage
  exit 1
fi

ROUTE_ID="workspace-${WORKSPACE_NAME}"
PATH_PREFIX="/workspace/${WORKSPACE_NAME}"

curl -fsSL -X POST "${ADMIN_URL}/config/apps/http/servers/srv0/routes" \
  -H "Content-Type: application/json" \
  -d "{\
    \"@id\": \"${ROUTE_ID}\",\
    \"match\": [{ \"path\": [\"${PATH_PREFIX}/*\"] }],\
    \"handle\": [\
      {\
        \"handler\": \"rewrite\",\
        \"strip_path_prefix\": \"${PATH_PREFIX}\"\
      },\
      {\
        \"handler\": \"reverse_proxy\",\
        \"upstreams\": [{ \"dial\": \"${VM_IP}:8080\" }],\
        \"flush_interval\": -1,\
        \"stream_timeout\": \"24h\",\
        \"stream_close_delay\": \"5s\"\
      }\
    ],\
    \"terminal\": true\
  }"

echo
