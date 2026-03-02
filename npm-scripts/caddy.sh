#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <subcommand> [options]"
  echo ""
  echo "Subcommands:"
  echo "  bootstrap              Load minimal Caddy config"
  echo "  add-route              Add a workspace route"
  echo "  remove-route           Remove a workspace route"
  echo ""
  echo "Options:"
  echo "  bootstrap [-a <admin_url>]"
  echo "  add-route -n <workspace_name> -i <vm_ip> [-a <admin_url>]"
  echo "  remove-route -n <workspace_name> [-a <admin_url>]"
  echo ""
  echo "Default: admin_url=http://localhost:2019"
}

cmd_bootstrap() {
  local ADMIN_URL="http://localhost:2019"

  while getopts ":a:h" opt; do
    case "$opt" in
      a) ADMIN_URL="$OPTARG" ;;
      h) usage; exit 0 ;;
      *) usage; exit 1 ;;
    esac
  done

  curl -fsSL -X POST "${ADMIN_URL}/load" \
    -H "Content-Type: application/json" \
    -d '{
      "apps": {
        "http": {
          "servers": {
            "srv0": {
              "listen": [":8080"],
              "routes": []
            },
            "srv1": {
              "listen": [":8081"],
              "routes": []
            }
          }
        }
      }
    }'

  echo
}

cmd_add_route() {
  local ADMIN_URL="http://localhost:2019"
  local WORKSPACE_NAME=""
  local VM_IP=""

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

  local ROUTE_ID="workspace-${WORKSPACE_NAME}"
  local PATH_PREFIX="/workspace/${WORKSPACE_NAME}"

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
}

cmd_remove_route() {
  local ADMIN_URL="http://localhost:2019"
  local WORKSPACE_NAME=""

  while getopts ":n:a:h" opt; do
    case "$opt" in
      n) WORKSPACE_NAME="$OPTARG" ;;
      a) ADMIN_URL="$OPTARG" ;;
      h) usage; exit 0 ;;
      *) usage; exit 1 ;;
    esac
  done

  if [ -z "$WORKSPACE_NAME" ]; then
    usage
    exit 1
  fi

  local ROUTE_ID="workspace-${WORKSPACE_NAME}"

  local ROUTES_JSON
  ROUTES_JSON=$(curl -fsSL "${ADMIN_URL}/config/apps/http/servers/srv0/routes")

  local ROUTE_INDEX
  ROUTE_INDEX=$(echo "$ROUTES_JSON" | jq -r --arg id "$ROUTE_ID" 'to_entries | map(select(.value["@id"] == $id)) | .[0].key')

  if [ "$ROUTE_INDEX" = "null" ] || [ -z "$ROUTE_INDEX" ]; then
    echo "Route not found: ${ROUTE_ID}"
    exit 1
  fi

  curl -fsSL -X DELETE "${ADMIN_URL}/config/apps/http/servers/srv0/routes/${ROUTE_INDEX}"

  echo
}

SUBCOMMAND="${1:-}"

if [ -z "$SUBCOMMAND" ]; then
  usage
  exit 1
fi

shift

case "$SUBCOMMAND" in
  bootstrap)    cmd_bootstrap "$@" ;;
  add-route)    cmd_add_route "$@" ;;
  remove-route) cmd_remove_route "$@" ;;
  -h|--help)    usage; exit 0 ;;
  *)            usage; exit 1 ;;
esac
