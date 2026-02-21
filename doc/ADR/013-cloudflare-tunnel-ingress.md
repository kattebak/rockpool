# ADR-013: Cloudflare Tunnel for external ingress

**Date**: 2026-02-21
**Status**: Accepted

## Context

The system runs on self-hosted hardware (home/office servers) without static IPs or open inbound ports. We need a way to expose the Caddy reverse proxy to the internet.

## Decision

Use **Cloudflare Tunnel** (`cloudflared`) to expose the Caddy endpoint externally. Traffic flows: internet → Cloudflare edge → tunnel → Caddy → workspace VMs.

Two-way door — can be swapped for Tailscale, WireGuard, or any other tunnel with minimal effort since Caddy is the real ingress point.

## Consequences

- No port forwarding, no static IP required.
- Free tier covers our needs.
- Adds a dependency on Cloudflare's edge network for external access. Local/LAN access works without it.
