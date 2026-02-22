#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [-i <image_name>] [-n <vm_name>]"
  echo "Defaults: image_name=ghcr.io/cirruslabs/ubuntu-runner-arm64:latest, vm_name=workspace-test"
}

IMAGE_NAME="ghcr.io/cirruslabs/ubuntu-runner-arm64:latest"
VM_NAME="workspace-test"

while getopts ":i:n:h" opt; do
  case "$opt" in
    i) IMAGE_NAME="$OPTARG" ;;
    n) VM_NAME="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

tart clone "$IMAGE_NAME" "$VM_NAME"
tart run "$VM_NAME" >/tmp/rockpool-${VM_NAME}.log 2>&1 &

sleep 2

tart ip "$VM_NAME"
