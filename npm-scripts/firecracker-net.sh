#!/usr/bin/env bash
set -euo pipefail

# Per-VM TAP device create/destroy.
# TAPs are pure L2 bridge ports — no IP addresses assigned.
# Usage:
#   sudo firecracker-net.sh create <tap-name> <bridge>
#   sudo firecracker-net.sh destroy <tap-name> <bridge>

if [ $# -lt 2 ]; then
  echo "Usage: $0 <create|destroy> <tap-name> <bridge>"
  echo ""
  echo "Examples:"
  echo "  $0 create rp-tap0 rockpool0"
  echo "  $0 destroy rp-tap0 rockpool0"
  exit 1
fi

ACTION=$1
TAP_NAME=$2
BRIDGE=${3:-rockpool0}

case "$ACTION" in
  create)
    if ip link show "$TAP_NAME" &>/dev/null; then
      ip link del "$TAP_NAME" 2>/dev/null || true
      echo "TAP $TAP_NAME existed (stale), recreating"
    fi
    ip tuntap add dev "$TAP_NAME" mode tap
    ip link set dev "$TAP_NAME" up
    ip link set dev "$TAP_NAME" master "$BRIDGE"
    echo "TAP $TAP_NAME created on bridge $BRIDGE"
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
