#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [-a <admin_url>]"
  echo "Default: admin_url=http://localhost:2019"
}

ADMIN_URL="http://localhost:2019"

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
          }
        }
      }
    }
  }'

echo
