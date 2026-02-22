#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [-b <vm_base_name>] [-n <vm_name>] [-u <ssh_user>] [-p <ssh_pass>]"
  echo "Defaults: vm_base_name=ghcr.io/cirruslabs/alpine:latest, vm_name=tidepool-alpine, ssh_user=admin, ssh_pass=admin"
}

VM_BASE_NAME="ghcr.io/cirruslabs/alpine:latest"
VM_NAME="tidepool-alpine"
SSH_USER="admin"
SSH_PASS="admin"

while getopts ":b:n:u:p:h" opt; do
  case "$opt" in
    b) VM_BASE_NAME="$OPTARG" ;;
    n) VM_NAME="$OPTARG" ;;
    u) SSH_USER="$OPTARG" ;;
    p) SSH_PASS="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$ROOT_DIR"

packer init images/alpine-workspace.pkr.hcl
packer build \
  -var "vm_base_name=${VM_BASE_NAME}" \
  -var "vm_name=${VM_NAME}" \
  -var "ssh_username=${SSH_USER}" \
  -var "ssh_password=${SSH_PASS}" \
  images/alpine-workspace.pkr.hcl
