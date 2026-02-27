#!/usr/bin/env bash
set -euo pipefail

# One-time bridge and NAT setup for Firecracker VMs.
# Run once with sudo before starting Rockpool on Linux.
#
# Usage: sudo firecracker-bridge-setup.sh

BRIDGE="rockpool0"
BRIDGE_IP="172.16.0.1/16"

if ! ip link show "$BRIDGE" &>/dev/null; then
  ip link add name "$BRIDGE" type bridge
  ip addr add "$BRIDGE_IP" dev "$BRIDGE"
  ip link set dev "$BRIDGE" up
  echo "Bridge $BRIDGE created at $BRIDGE_IP"
else
  echo "Bridge $BRIDGE already exists, skipping creation"
fi

echo 1 > /proc/sys/net/ipv4/ip_forward

HOST_IFACE=$(ip -j route list default | jq -r '.[0].dev')

if [ -z "$HOST_IFACE" ] || [ "$HOST_IFACE" = "null" ]; then
  echo "ERROR: Could not determine default network interface."
  echo "Ensure you have a default route configured."
  exit 1
fi

iptables -t nat -C POSTROUTING -o "$HOST_IFACE" -s 172.16.0.0/16 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -o "$HOST_IFACE" -s 172.16.0.0/16 -j MASQUERADE

iptables -C FORWARD -i "$BRIDGE" -o "$HOST_IFACE" -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -i "$BRIDGE" -o "$HOST_IFACE" -j ACCEPT

iptables -C FORWARD -i "$HOST_IFACE" -o "$BRIDGE" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -i "$HOST_IFACE" -o "$BRIDGE" -m state --state RELATED,ESTABLISHED -j ACCEPT

iptables -C FORWARD -i "$BRIDGE" -o "$BRIDGE" -j DROP 2>/dev/null || \
  iptables -A FORWARD -i "$BRIDGE" -o "$BRIDGE" -j DROP

echo "Bridge $BRIDGE configured at $BRIDGE_IP with NAT via $HOST_IFACE"
