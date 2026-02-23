#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export TART_HOME="${TART_HOME:-${ROOT_DIR}/.tart}"

usage() {
  echo "Usage: $0 [-n <vm_name>] [-w <workspace_name>]"
  echo "Defaults: vm_name=workspace-test, workspace_name=test"
}

VM_NAME="workspace-test"
WORKSPACE_NAME="test"

while getopts ":n:w:h" opt; do
  case "$opt" in
    n) VM_NAME="$OPTARG" ;;
    w) WORKSPACE_NAME="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

tart exec "$VM_NAME" bash -lc "
if ! command -v code-server >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y curl git jq
  curl -fsSL https://code-server.dev/install.sh | sudo sh
fi

mkdir -p /home/admin/.config/code-server /home/admin/workspace
cat > /home/admin/.config/code-server/config.yaml <<EOF
bind-addr: 0.0.0.0:8080
auth: none
cert: false
abs-proxy-base-path: /workspace/${WORKSPACE_NAME}
EOF

sudo chown -R admin:admin /home/admin/.config /home/admin/workspace
sudo systemctl enable --now code-server@admin
"