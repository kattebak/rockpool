#!/usr/bin/env bash
set -euo pipefail

ACTION=$1
TAP_NAME=$2
TAP_IP=$3
BRIDGE=$4

case "$ACTION" in
  create)
    ip tuntap add dev "$TAP_NAME" mode tap
    ip addr add "$TAP_IP" dev "$TAP_NAME"
    ip link set dev "$TAP_NAME" up
    ip link set dev "$TAP_NAME" master "$BRIDGE"
    ;;
  destroy)
    ip link set dev "$TAP_NAME" down 2>/dev/null || true
    ip link del "$TAP_NAME" 2>/dev/null || true
    ;;
esac
