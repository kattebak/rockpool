# ADR-015: Three-port origin isolation for workspace security

**Date**: 2026-02-22
**Status**: Accepted
**Updated**: 2026-02-22

## Context

All traffic (control plane API, SPA, workspace IDE, user app port-forwards) is served through a single Caddy listener on `:8080`. This means everything shares the same browser origin (`localhost:8080`).

Any JavaScript running inside a workspace — whether from code-server extensions, a user's dev server proxied via port forwarding, or a compromised dependency — can make credentialed requests to `/api/*` because it is the same origin. The browser attaches auth cookies automatically. A malicious script in a workspace could CRUD other workspaces, exfiltrate data, or escalate privileges.

Path-based routing alone does not provide origin isolation. The browser's same-origin policy only distinguishes by scheme + host + port.

IDE sessions and port-forwarded app previews are separated onto different ports for origin isolation — preview JS cannot interfere with IDE sessions and vice versa. Both use the same auth mechanism (cookie + forward_auth), keeping the IDE backend interchangeable.

## Decision

Split Caddy into three listeners on separate ports:

| Port    | Routes                            | Auth                 | Purpose              |
| ------- | --------------------------------- | -------------------- | -------------------- |
| `:8080` | `/api/*`, `/app/*`                | Session cookie       | Control plane + SPA  |
| `:8081` | `/workspace/{name}/*`             | Cookie + forward_auth | IDE sessions         |
| `:8082` | `/workspace/{name}/port/{port}/*` | Cookie + forward_auth | App previews        |

No CORS headers are set across any origin pair. The session cookie is domain-scoped (not port-scoped per RFC 6265 §8.5), so it flows from `:8080` to `:8081` and `:8082` automatically for forward_auth. In production with subdomains (`app.rockpool.dev`, `ide.rockpool.dev`, `preview.rockpool.dev`), the cookie is set with `Domain=.rockpool.dev`. The cookie is `HttpOnly` (workspace JS cannot read it), `SameSite=Lax`, and `Secure` in production.

All workspaces share `:8081` (IDE) and `:8082` (previews). Same-user workspaces can technically interfere with each other at the browser layer, but they are already isolated at the VM layer — and same-user cross-workspace interference is acceptable risk.

For Cloudflare Tunnel (or any external ingress), three tunnel routes map to the three Caddy ports. This is straightforward — `cloudflared` supports multiple ingress rules.

## Consequences

- Three isolation boundaries: preview JS cannot reach the IDE or control plane, IDE JS cannot reach the control plane or previews.
- Auth is transparent to all downstream apps — forward_auth validates the session cookie before proxying. IDEs run with auth disabled (e.g. `--auth none`), making the IDE backend interchangeable (code-server, JupyterLab, Theia, etc.).
- Session cookie is `HttpOnly` — workspace JS cannot read it via `document.cookie`, even though the browser sends it automatically.
- Minimal complexity cost — Caddy binds three listeners instead of one.
- External ingress needs three tunnel routes. Both `cloudflared` and Tailscale handle this natively.
- Port routes live on a separate server (srv2), eliminating the subroute ordering issues that existed when IDE and port routes shared srv1.
