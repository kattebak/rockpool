#!/usr/bin/env bash
set -euo pipefail

BRIDGE="rockpool0"
BRIDGE_IP="172.16.0.1/16"

# Create bridge if it doesn't exist
if ! ip link show "$BRIDGE" &>/dev/null; then
    ip link add name "$BRIDGE" type bridge
    ip addr add "$BRIDGE_IP" dev "$BRIDGE"
    ip link set dev "$BRIDGE" up
fi

# Enable IP forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward

# Determine outbound interface
HOST_IFACE=$(ip -j route list default | jq -r '.[0].dev')

# NAT for VM internet access
iptables -t nat -C POSTROUTING -o "$HOST_IFACE" -s 172.16.0.0/16 -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -o "$HOST_IFACE" -s 172.16.0.0/16 -j MASQUERADE

# Allow forwarding from bridge
iptables -C FORWARD -i "$BRIDGE" -o "$HOST_IFACE" -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i "$BRIDGE" -o "$HOST_IFACE" -j ACCEPT
iptables -C FORWARD -i "$HOST_IFACE" -o "$BRIDGE" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i "$HOST_IFACE" -o "$BRIDGE" -m state --state RELATED,ESTABLISHED -j ACCEPT

# Block inter-VM traffic (VMs should not talk to each other)
iptables -C FORWARD -i "$BRIDGE" -o "$BRIDGE" -j DROP 2>/dev/null || \
    iptables -A FORWARD -i "$BRIDGE" -o "$BRIDGE" -j DROP

echo "Bridge $BRIDGE configured at $BRIDGE_IP with NAT via $HOST_IFACE"
