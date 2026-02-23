#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export TART_HOME="${TART_HOME:-${ROOT_DIR}/.tart}"

usage() {
  echo "Usage: $0 [-n <vm_name>] [-w <workspace_name>] [-u <base_url>]"
  echo "Defaults: vm_name=workspace-test, workspace_name=test, base_url=http://localhost:8080"
}

VM_NAME="workspace-test"
WORKSPACE_NAME="test"
BASE_URL="http://localhost:8080"

while getopts ":n:w:u:h" opt; do
  case "$opt" in
    n) VM_NAME="$OPTARG" ;;
    w) WORKSPACE_NAME="$OPTARG" ;;
    u) BASE_URL="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

VM_IP="$(tart ip "$VM_NAME")"

curl -fsS "http://${VM_IP}:8080/healthz" >/dev/null

STATUS_CODE="$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/workspace/${WORKSPACE_NAME}/")"
case "$STATUS_CODE" in
  200|301|302|307|308) exit 0 ;;
  *)
    echo "Unexpected status code: ${STATUS_CODE}"
    exit 1
    ;;
esac
