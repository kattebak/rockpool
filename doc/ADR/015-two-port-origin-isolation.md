# ADR-015: Two-port origin isolation for workspace security

**Date**: 2026-02-22
**Status**: Accepted

## Context

All traffic (control plane API, SPA, workspace IDE, user app port-forwards) is served through a single Caddy listener on `:8080`. This means everything shares the same browser origin (`localhost:8080`).

Any JavaScript running inside a workspace — whether from code-server extensions, a user's dev server proxied via port forwarding, or a compromised dependency — can make credentialed requests to `/api/*` because it is the same origin. The browser attaches auth cookies automatically. A malicious script in a workspace could CRUD other workspaces, exfiltrate data, or escalate privileges.

Path-based routing alone does not provide origin isolation. The browser's same-origin policy only distinguishes by scheme + host + port.

## Decision

Split Caddy into two listeners on separate ports:

| Port    | Routes                         | Purpose                          |
| ------- | ------------------------------ | -------------------------------- |
| `:8080` | `/api/*`, `/app/*`             | Control plane API + SPA          |
| `:8081` | `/workspace/{name}/*`          | All workspace IDE + port-forward |

The control plane origin (`:8080`) never sets CORS headers for the workspace origin (`:8081`). Auth cookies are scoped to `:8080` and are never sent to `:8081`.

All workspace traffic shares a single port. Workspaces belonging to the same user can technically interfere with each other at the browser layer, but they are already isolated at the VM layer — and same-user cross-workspace interference is acceptable risk.

For Cloudflare Tunnel (or any external ingress), two tunnel routes map to the two Caddy ports. This is straightforward — `cloudflared` supports multiple ingress rules.

## Consequences

- Workspace JavaScript physically cannot reach the control plane API — different origin, no CORS, no cookies.
- Auth cookies scoped to `:8080` are never exposed to workspace content.
- Minimal complexity cost — Caddy binds two listeners instead of one.
- External ingress needs two tunnel routes (or a single tunnel to a local proxy that splits). Both `cloudflared` and Tailscale handle this natively.
- Future upgrade to `forward_auth` or JWT benefits from this split — auth tokens never leak to workspace origins.
