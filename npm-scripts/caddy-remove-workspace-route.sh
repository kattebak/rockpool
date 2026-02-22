#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 -n <workspace_name> [-a <admin_url>]"
  echo "Example: $0 -n test"
}

ADMIN_URL="http://localhost:2019"
WORKSPACE_NAME=""

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

ROUTE_ID="workspace-${WORKSPACE_NAME}"

ROUTES_JSON=$(curl -fsSL "${ADMIN_URL}/config/apps/http/servers/srv0/routes")
ROUTE_INDEX=$(echo "$ROUTES_JSON" | jq -r --arg id "$ROUTE_ID" 'to_entries | map(select(.value["@id"] == $id)) | .[0].key')

if [ "$ROUTE_INDEX" = "null" ] || [ -z "$ROUTE_INDEX" ]; then
  echo "Route not found: ${ROUTE_ID}"
  exit 1
fi

curl -fsSL -X DELETE "${ADMIN_URL}/config/apps/http/servers/srv0/routes/${ROUTE_INDEX}"

echo
