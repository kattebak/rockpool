#!/bin/bash
# Guest-side network setup for Firecracker VMs.
# Reads IP configuration from kernel command line parameters:
#   rockpool.ip=<guest-ip> rockpool.gw=<gateway-ip> rockpool.mask=<cidr-mask>

IP=$(cat /proc/cmdline | tr ' ' '\n' | grep rockpool.ip= | cut -d= -f2)
GW=$(cat /proc/cmdline | tr ' ' '\n' | grep rockpool.gw= | cut -d= -f2)
MASK=$(cat /proc/cmdline | tr ' ' '\n' | grep rockpool.mask= | cut -d= -f2)

if [ -n "$IP" ] && [ -n "$GW" ] && [ -n "$MASK" ]; then
    ip addr add "${IP}/${MASK}" dev eth0
    ip link set dev eth0 up
    ip route add default via "$GW"
    echo "nameserver 1.1.1.1" > /etc/resolv.conf
    echo "nameserver 8.8.8.8" >> /etc/resolv.conf
    echo "Network configured: ${IP}/${MASK} via ${GW}"
else
    echo "WARNING: Missing network parameters on kernel cmdline"
    echo "  Expected: rockpool.ip=<ip> rockpool.gw=<gw> rockpool.mask=<mask>"
fi
