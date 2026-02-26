#!/usr/bin/env bash
set -euo pipefail

# Per-VM TAP device create/destroy.
# Usage:
#   sudo firecracker-net.sh create <tap-name> <tap-ip/mask> <bridge>
#   sudo firecracker-net.sh destroy <tap-name> "" <bridge>

if [ $# -lt 3 ]; then
  echo "Usage: $0 <create|destroy> <tap-name> <tap-ip/mask> <bridge>"
  echo ""
  echo "Examples:"
  echo "  $0 create rp-tap0 172.16.0.1/30 rockpool0"
  echo "  $0 destroy rp-tap0 \"\" rockpool0"
  exit 1
fi

ACTION=$1
TAP_NAME=$2
TAP_IP=$3
BRIDGE=${4:-rockpool0}

case "$ACTION" in
  create)
    if ip link show "$TAP_NAME" &>/dev/null; then
      echo "TAP $TAP_NAME already exists, skipping creation"
      exit 0
    fi
    ip tuntap add dev "$TAP_NAME" mode tap
    ip addr add "$TAP_IP" dev "$TAP_NAME"
    ip link set dev "$TAP_NAME" up
    ip link set dev "$TAP_NAME" master "$BRIDGE"
    echo "TAP $TAP_NAME created at $TAP_IP on bridge $BRIDGE"
    ;;
  destroy)
    if ! ip link show "$TAP_NAME" &>/dev/null; then
      echo "TAP $TAP_NAME does not exist, skipping"
      exit 0
    fi
    ip link set dev "$TAP_NAME" down 2>/dev/null || true
    ip link del "$TAP_NAME" 2>/dev/null || true
    echo "TAP $TAP_NAME destroyed"
    ;;
  *)
    echo "Unknown action: $ACTION (expected 'create' or 'destroy')"
    exit 1
    ;;
esac
