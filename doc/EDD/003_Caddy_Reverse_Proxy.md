# EDD: Caddy Reverse Proxy Configuration

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Draft      |
| Created | 2026-02-21 |
| Updated | 2026-02-23 |

## Summary

Caddy serves as the HTTP entry point for Rockpool, running inside the root VM alongside the control plane. Traffic is split across three listeners for origin isolation: `:8080` serves the control plane API and SPA, `:8081` serves IDE (code-server) sessions, `:8082` serves port-forwarded app previews. Each listener is a separate browser origin, preventing workspace-hosted JavaScript from reaching the control plane or IDE sessions from interfering with app previews. See [ADR-015](../ADR/015-three-port-origin-isolation.md).

The control plane configures Caddy's routes via its admin API on localhost as workspaces are created and destroyed. All routing is path-based (no subdomains). The root VM is network-isolated from the host LAN; workspace VMs are further isolated from each other.

## API Gateway Responsibilities

Caddy is the API gateway for all inbound traffic. It is responsible for:

- Basic auth for local/testing and CI
- Rate limiting at the edge (see [EDD 007](007_Data_Model.md))
- Routing and path prefix handling

Caddy does **not** handle OAuth. GitHub OAuth is handled by the control plane itself (see below).

### Authentication Modes

#### Basic Auth (Caddy-level, for dev/CI)

- Use Caddy's built-in `basic_auth` directive.
- No external identity provider required.
- Suitable for localhost, quick testing, and CI integration tests.
- Controlled via `CADDY_USERNAME`/`CADDY_PASSWORD` env vars.

#### GitHub OAuth (control plane, for production)

OAuth is handled in the control plane as a separate `@rockpool/auth` package, not in Caddy. This gives the server full control over the GitHub access token, which is needed for:

- Cloning private repos into workspace VMs
- Querying the GitHub API (list repos, org membership)
- Pre-configuring git credentials inside workspaces

The auth flow:

1. Browser hits `GET /api/auth/github` → server redirects to GitHub's OAuth authorize URL
2. User authenticates on GitHub → GitHub redirects to `GET /api/auth/callback`
3. Server exchanges the authorization code for an access token
4. Server creates a session (cookie-based), stores the GitHub token server-side
5. Subsequent API requests are authenticated via session cookie
6. Session middleware protects `/api/workspaces/*` and other CRUD routes

Auth endpoints (served by `@rockpool/auth`, mounted on the control plane):

| Endpoint             | Method | Purpose                                                |
| -------------------- | ------ | ------------------------------------------------------ |
| `/api/auth/github`   | GET    | Redirect to GitHub OAuth                               |
| `/api/auth/callback` | GET    | Exchange code for token, create session                |
| `/api/auth/me`       | GET    | Return current user info                               |
| `/api/auth/verify`   | GET    | Validate session for forward_auth (returns 200 or 401) |
| `/api/auth/logout`   | POST   | Destroy session                                        |

GitHub OAuth works on localhost — the callback URL (e.g. `http://localhost:8080/api/auth/callback`) only needs to be reachable by the user's browser, not by GitHub's servers. A tunnel is only needed for webhooks, not for the OAuth login flow.

When OAuth is enabled (`GITHUB_OAUTH_CLIENT_ID` is set), Caddy does not apply basic auth — it just proxies to the control plane, which enforces sessions. When OAuth is not configured, the existing Caddy basic auth mode is used (for dev/CI).

### Workspace Authentication (forward_auth on srv1 + srv2)

Both IDE traffic (`:8081`) and app preview traffic (`:8082`) are authenticated via Caddy's forward_auth mechanism. In basic auth mode, Caddy's built-in `http_basic` handler covers all three ports. In OAuth mode, srv1 and srv2 use a forward_auth subrequest to the control plane's verify endpoint.

This keeps auth at the Caddy layer, so any IDE backend (code-server, JupyterLab, Theia, etc.) runs with auth disabled — Caddy gates access before the request reaches the IDE. Fully portable, no per-IDE auth glue.

The session cookie set during OAuth login on `:8080` is also sent by the browser to `:8081` and `:8082` — cookies are domain-scoped, not port-scoped ([RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265.html#section-8.5)). In production with subdomains (e.g. `app.rockpool.dev`, `ide.rockpool.dev`, `preview.rockpool.dev`), the session cookie is set with `Domain=.rockpool.dev` so it flows to all three. Origin isolation still holds: JavaScript's Same-Origin Policy is port-sensitive, so workspace JS cannot make credentialed `fetch` requests to `:8080`.

The forward_auth flow (identical on srv1 and srv2):

1. Browser requests `:8081/workspace/alice/` — session cookie is attached
2. Caddy makes a server-side GET to `localhost:7163/api/auth/verify`, forwarding the original request headers (including the cookie) plus `X-Forwarded-Method`, `X-Forwarded-Uri`, `X-Forwarded-Host`, and `X-Forwarded-Proto` so the verify endpoint has full origin context
3. Verify endpoint checks the session:
   - **Valid session**: returns `200` with `X-Authenticated-User` header
   - **Invalid/missing session**: returns `401`
4. On 200, Caddy copies `X-Authenticated-User` into the original request and continues to the upstream proxy
5. On 401, Caddy redirects to the login page on srv0 with a URL-encoded `return_to` parameter, so the user lands back at the workspace after authenticating. The control plane validates `return_to` against an allowlist (same host and expected ports) before redirecting.

The `forward_auth` Caddyfile directive is built into standard Caddy. It expands to a `reverse_proxy` + `handle_response` chain — all native handlers, no plugins. In OAuth mode, the forward_auth handler replaces the basic auth `subroute` inside each workspace/port route (see the OAuth mode block in Workspace Routes below). The `X-Authenticated-User` header set by the verify endpoint is also usable as an identity key for `caddy-ratelimit`, solving rate limiting identity in OAuth mode.

### Rate Limiting

Rate limiting uses **`github.com/mholt/caddy-ratelimit`**, compiled into Caddy with `xcaddy`.

Default limits (per identity), aligned with [EDD 007](007_Data_Model.md):

| Scope                                                     | Soft limit | Hard limit  |
| --------------------------------------------------------- | ---------- | ----------- |
| General endpoints                                         | 60 req/min | 300 req/min |
| Lifecycle endpoints (`create`, `delete`, `start`, `stop`) | 10 req/min | 30 req/min  |

Exceeding the hard limit returns `429` with a JSON error body (see EDD 007 error conventions).

Identity key order:

1. `X-Authenticated-User` header (set by forward_auth or basic auth username)
2. `CF-Connecting-IP` header (when behind Cloudflare Tunnel — see Trusted Proxy Headers below)
3. Client IP (fallback)

### Trusted Proxy Headers

When running behind Cloudflare Tunnel (or Tailscale Funnel), Caddy must trust specific headers injected by the upstream proxy for correct client identification and audit logging.

| Header              | Set by     | Purpose                                       |
| ------------------- | ---------- | --------------------------------------------- |
| `CF-Connecting-IP`  | Cloudflare | True client IP (used for rate-limit fallback) |
| `CF-IPCountry`      | Cloudflare | Client country code (audit logs)              |
| `CF-Ray`            | Cloudflare | Request trace ID (debugging)                  |
| `X-Forwarded-For`   | Cloudflare | Client IP chain (standard, may be spoofed)    |
| `X-Forwarded-Proto` | Cloudflare | Original protocol (`https`)                   |

Caddy's `trusted_proxies` directive must be configured to only accept these headers from the Cloudflare/Tailscale source IP ranges. Without this, a direct client could spoof `CF-Connecting-IP` and bypass per-IP rate limits.

In local development (no tunnel), these headers are absent and Caddy falls back to the TCP source IP for rate limiting.

## Admin API Basics

Caddy exposes a REST API on `localhost:2019` by default.

| Method   | Endpoint         | Behavior                           |
| -------- | ---------------- | ---------------------------------- |
| `GET`    | `/config/[path]` | Read config at path                |
| `POST`   | `/config/[path]` | Append to arrays, create objects   |
| `PUT`    | `/config/[path]` | Insert at position or create       |
| `PATCH`  | `/config/[path]` | Replace existing values            |
| `DELETE` | `/config/[path]` | Remove config at path              |
| `DELETE` | `/id/{id}`       | Remove object by `@id` (preferred) |

Config tree path: `apps.http.servers.{serverName}.routes[index]`

Control plane routes live under `srv0`, IDE workspace routes under `srv1`, app preview routes under `srv2`.

## Origin Isolation

All traffic is split across three Caddy servers on separate ports:

| Server | Port    | Routes                            | Auth                   | Purpose                 |
| ------ | ------- | --------------------------------- | ---------------------- | ----------------------- |
| `srv0` | `:8080` | `/api/*`, `/app/*`                | Session cookie (OAuth) | Control plane API + SPA |
| `srv1` | `:8081` | `/workspace/{name}/*`             | Cookie + forward_auth  | IDE sessions            |
| `srv2` | `:8082` | `/workspace/{name}/port/{port}/*` | Cookie + forward_auth  | App previews            |

Different ports = different browser origins. No CORS headers are set across origins. This gives three isolation boundaries:

- **App preview JS** (`:8082`) cannot reach the control plane API (`:8080`) or the IDE (`:8081`)
- **IDE JS** (`:8081`) cannot reach the control plane API (`:8080`) or app previews (`:8082`)
- **Control plane** (`:8080`) is the only origin that holds session state

The session cookie is domain-scoped, not port-scoped (RFC 6265 §8.5), so it flows from `:8080` to `:8081` and `:8082` automatically. In production with subdomains, the cookie is set with `Domain=.rockpool.dev` to flow across all three subdomains. The cookie is set `HttpOnly` (workspace JS cannot read it via `document.cookie`), `SameSite=Lax` (not sent in cross-site requests), and `Secure` in production (HTTPS only).

For external ingress, Cloudflare Tunnel maps three ingress rules to the three ports. Both `cloudflared` and Tailscale support this natively.

## Bootstrap Configuration

Load initial config via `POST /load`:

Auth handlers are embedded inside each route's handler chain as a `subroute`, not as a separate catch-all route. This prevents a top-level auth matcher from short-circuiting later routes and keeps auth + proxy as a single unit per logical endpoint. For srv1/srv2, auth is applied in each workspace/port route rather than a shared `/*` auth-only route.

```json
{
  "apps": {
    "http": {
      "servers": {
        "srv0": {
          "listen": [":8080"],
          "routes": [
            {
              "@id": "control-plane",
              "match": [{ "path": ["/api/*"] }],
              "handle": [
                {
                  "handler": "subroute",
                  "routes": [
                    {
                      "handle": [
                        {
                          "handler": "authentication",
                          "providers": {
                            "http_basic": {
                              "accounts": [
                                {
                                  "username": "admin",
                                  "password": "$HASHED_PASSWORD"
                                }
                              ]
                            }
                          }
                        }
                      ]
                    },
                    {
                      "handle": [
                        {
                          "handler": "reverse_proxy",
                          "upstreams": [{ "dial": "localhost:7163" }]
                        }
                      ]
                    }
                  ]
                }
              ],
              "terminal": true
            },
            {
              "@id": "spa",
              "match": [{ "path": ["/app/*"] }],
              "handle": [
                {
                  "handler": "subroute",
                  "routes": [
                    {
                      "handle": [
                        {
                          "handler": "authentication",
                          "providers": {
                            "http_basic": {
                              "accounts": [
                                {
                                  "username": "admin",
                                  "password": "$HASHED_PASSWORD"
                                }
                              ]
                            }
                          }
                        }
                      ]
                    },
                    {
                      "handle": [
                        {
                          "handler": "reverse_proxy",
                          "upstreams": [{ "dial": "localhost:7163" }]
                        }
                      ]
                    }
                  ]
                }
              ],
              "terminal": true
            }
          ]
        },
        "srv1": {
          "listen": [":8081"],
          "routes": []
        },
        "srv2": {
          "listen": [":8082"],
          "routes": []
        }
      }
    }
  }
}
```

IDE workspace routes are added dynamically to `srv1`, app preview routes to `srv2` (see below). Each dynamic route includes its own auth handler chain (basic auth or forward_auth) before proxying to the upstream.

## Workspace Routes (srv1)

When a workspace is created, the control plane POSTs a route to `srv1`. Key settings:

- **`strip_path_prefix`**: Removes `/workspace/alice` so code-server sees `/` as root
- **`flush_interval: -1`**: Disables buffering for low-latency terminal/IDE output
- **`stream_timeout: "24h"`**: Long-lived WebSocket connections for IDE sessions
- **`stream_close_delay: "5s"`**: Keeps WebSockets alive during config reloads

The route matches both the bare path `/workspace/alice` and the subtree `/workspace/alice/*`. A bare path without a trailing slash is redirected to the slash-suffixed form so relative asset URLs inside the IDE resolve correctly. The workspace route includes auth + proxy handlers in a single chain.

Auth handler blocks (insert as the first handler in each workspace/port route).

Swap the auth block based on the mode:

- Basic auth mode: use the first block below.
- OAuth mode: replace the basic auth block with the forward_auth block below.

Basic auth mode (dev/CI):

```json
{
  "handler": "subroute",
  "routes": [
    {
      "handle": [
        {
          "handler": "authentication",
          "providers": {
            "http_basic": {
              "accounts": [
                {
                  "username": "admin",
                  "password": "$HASHED_PASSWORD"
                }
              ]
            }
          }
        }
      ]
    }
  ]
}
```

OAuth mode (production, forward_auth):

```json
{
  "handler": "reverse_proxy",
  "upstreams": [{ "dial": "localhost:7163" }],
  "rewrite": { "method": "GET", "uri": "/api/auth/verify" },
  "headers": {
    "request": {
      "set": {
        "X-Forwarded-Method": ["{http.request.method}"],
        "X-Forwarded-Uri": ["{http.request.uri}"],
        "X-Forwarded-Host": ["{http.request.host}"],
        "X-Forwarded-Proto": ["{http.request.scheme}"]
      }
    }
  },
  "handle_response": [
    {
      "match": { "status_code": [2] },
      "routes": [
        {
          "handle": [
            {
              "handler": "headers",
              "request": {
                "set": {
                  "X-Authenticated-User": [
                    "{http.reverse_proxy.header.X-Authenticated-User}"
                  ]
                }
              }
            }
          ]
        }
      ]
    },
    {
      "match": { "status_code": [401] },
      "routes": [
        {
          "handle": [
            {
              "handler": "static_response",
              "status_code": 302,
              "headers": {
                "Location": [
                  "http://{http.request.host}:8080/api/auth/github?return_to={http.request.scheme}://{http.request.hostport}{http.request.uri}"
                ]
              }
            }
          ]
        }
      ]
    }
  ]
}
```

Example below uses basic auth. Swap the auth block for the OAuth block when OAuth is enabled.

```json
[
  {
    "@id": "workspace-alice-redirect",
    "match": [{ "path": ["/workspace/alice"] }],
    "handle": [
      {
        "handler": "static_response",
        "status_code": 302,
        "headers": {
          "Location": ["/workspace/alice/"]
        }
      }
    ],
    "terminal": true
  },
  {
    "@id": "workspace-alice",
    "match": [{ "path": ["/workspace/alice/*"] }],
    "handle": [
      {
        "handler": "subroute",
        "routes": [
          {
            "handle": [
              {
                "handler": "authentication",
                "providers": {
                  "http_basic": {
                    "accounts": [
                      {
                        "username": "admin",
                        "password": "$HASHED_PASSWORD"
                      }
                    ]
                  }
                }
              }
            ]
          }
        ]
      },
      { "handler": "rewrite", "strip_path_prefix": "/workspace/alice" },
      {
        "handler": "reverse_proxy",
        "upstreams": [{ "dial": "10.0.1.50:8080" }],
        "flush_interval": -1,
        "stream_timeout": "24h",
        "stream_close_delay": "5s"
      }
    ],
    "terminal": true
  }
]
```

The redirect route is added alongside the workspace route. Both are removed when the workspace is destroyed. The same pattern applies to port routes on srv2 (`/workspace/alice/port/3000` → `/workspace/alice/port/3000/`).

## App Preview Routes (srv2)

Ports are registered dynamically via the API (`POST /api/workspaces/{id}/ports`, see [EDD 007](007_Data_Model.md)). When a user registers a port, the server creates a Caddy route on srv2. When unregistered, the route is deleted. Up to 5 ports per workspace.

If a port is registered but no service is listening inside the VM, the proxy returns `502` until the port is live. Port routes include auth + proxy handlers in a single chain, mirroring the workspace route pattern. Replace the auth block shown here with the OAuth block when OAuth is enabled.

### Adding a port route (on port registration)

When the user registers port 3000:

```bash
POST http://localhost:2019/config/apps/http/servers/srv2/routes
```

```json
[
  {
    "@id": "workspace-alice-port-3000-redirect",
    "match": [{ "path": ["/workspace/alice/port/3000"] }],
    "handle": [
      {
        "handler": "static_response",
        "status_code": 302,
        "headers": {
          "Location": ["/workspace/alice/port/3000/"]
        }
      }
    ],
    "terminal": true
  },
  {
    "@id": "workspace-alice-port-3000",
    "match": [{ "path": ["/workspace/alice/port/3000/*"] }],
    "handle": [
      {
        "handler": "subroute",
        "routes": [
          {
            "handle": [
              {
                "handler": "authentication",
                "providers": {
                  "http_basic": {
                    "accounts": [
                      {
                        "username": "admin",
                        "password": "$HASHED_PASSWORD"
                      }
                    ]
                  }
                }
              }
            ]
          }
        ]
      },
      { "handler": "rewrite", "strip_path_prefix": "/workspace/alice/port/3000" },
      {
        "handler": "reverse_proxy",
        "upstreams": [{ "dial": "10.0.1.50:3000" }],
        "flush_interval": -1,
        "headers": {
          "request": {
            "set": {
              "X-Forwarded-Prefix": ["/workspace/alice/port/3000"]
            }
          }
        }
      }
    ],
    "terminal": true
  }
]
```

Port routes are top-level routes on srv2 — no subroute nesting, no ordering issues. Both the redirect and proxy route are POSTed together and removed together.

### Removing a port route

```bash
DELETE http://localhost:2019/id/workspace-alice-port-3000
DELETE http://localhost:2019/id/workspace-alice-port-3000-redirect
```

### Route ID convention

- Workspace IDE: `workspace-{name}`
- Workspace redirect: `workspace-{name}-redirect`
- App preview: `workspace-{name}-port-{port}`
- App preview redirect: `workspace-{name}-port-{port}-redirect`

## Removing a Workspace

Delete by `@id` (stable, not affected by array index shifts). Both the workspace route and its redirect route must be removed:

```bash
DELETE http://localhost:2019/id/workspace-alice
DELETE http://localhost:2019/id/workspace-alice-redirect
```

Port routes and their redirects on srv2 are independent — they must be removed separately (or the control plane removes all `workspace-{name}-port-*` and `workspace-{name}-port-*-redirect` routes when a workspace is destroyed).

## WebSocket Support

WebSocket proxying is automatic in Caddy v2. No explicit configuration needed. Caddy detects the HTTP Upgrade header and transitions to a bidirectional tunnel.

For IDE stability:

- `flush_interval: -1` -- low-latency streaming
- `stream_timeout: "24h"` -- long-lived sessions
- `stream_close_delay: "5s"` -- survive config reloads without dropping connections

## The Subfolder Problem

Web apps designed to serve from `/` can break when mounted at `/workspace/alice/` because they generate absolute links like `/static/main.js` instead of relative ones.

**Solutions in order of preference:**

1. **Configure the backend's base path** -- code-server supports `--abs-proxy-base-path`
2. **`X-Forwarded-Prefix` header** -- some apps adjust URL generation based on this
3. **Caddy `replace-response` plugin** -- rewrite HTML as last resort (fragile)

code-server handles this well natively. Coder does not (requires wildcard subdomains).

## TypeScript Client

The API is simple enough that plain `fetch` is sufficient:

```typescript
const CADDY_ADMIN = "http://localhost:2019";

async function addRoute(route: CaddyRoute): Promise<void> {
  const response = await fetch(
    `${CADDY_ADMIN}/config/apps/http/servers/srv1/routes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(route),
    },
  );
  if (!response.ok)
    throw new Error(`Caddy: ${response.status} ${await response.text()}`);
}

async function removeRoute(id: string): Promise<void> {
  const response = await fetch(`${CADDY_ADMIN}/id/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404)
    throw new Error(`Caddy: ${response.status}`);
}
```

## Concurrency

Use `ETag`/`If-Match` headers for optimistic concurrency when multiple requests may modify config simultaneously. GET returns an `ETag`, pass it as `If-Match` on mutations.

## Workspace Environment Contract

Workspace identity is communicated to the VM via environment variables, set by the worker at VM creation time (see [EDD 008](008_Package_Structure.md), `RuntimeRepository`).

| Variable                  | Example | Description                                                                                                                      |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ROCKPOOL_WORKSPACE_NAME` | `alice` | Workspace slug. Used by code-server for `--abs-proxy-base-path /workspace/alice` and by apps that need to know their URL prefix. |

The base image's code-server init script reads `ROCKPOOL_WORKSPACE_NAME` to set the base path (see [EDD 005](005_Workspace_Image_Pipeline.md)). Port forwarding is managed dynamically via the API -- apps bind to whatever port they want, then the user registers it through the control plane.

## Decisions

- **Caddy runs in the root VM** alongside the control plane — admin API on localhost only, network-isolated from host LAN
- **Three-port origin isolation**: `:8080` for control plane + SPA, `:8081` for IDE sessions, `:8082` for app previews — each a separate browser origin, prevents cross-boundary JS access ([ADR-015](../ADR/015-three-port-origin-isolation.md))
- **Basic auth in Caddy** for dev/CI. **Implemented** in `@rockpool/caddy`: `hashPassword()` generates bcrypt hashes, `buildBootstrapConfig({ auth })` adds authentication handlers to srv0 protecting `/api/*` and `/app/*` with a health check bypass on `/api/health`. Wired into server startup via `CADDY_USERNAME`/`CADDY_PASSWORD` env vars — server bootstraps Caddy with auth on startup when not in stub mode.
- **GitHub OAuth in the control plane** via `@rockpool/auth` package. Server handles the full OAuth flow, stores GitHub access tokens server-side, and manages sessions via cookies. Caddy stays as a pass-through proxy when OAuth is enabled. This gives the control plane direct access to GitHub tokens for repo cloning, API queries, and git credential injection into workspaces.
- **Workspace auth via forward_auth**: srv1 and srv2 authenticate workspace and preview traffic by making a subrequest to the control plane's `/api/auth/verify` endpoint. The session cookie flows cross-port per RFC 6265 §8.5 (domain-scoped, not port-scoped) or cross-subdomain via `Domain=.rockpool.dev` in production. Cookie is set `HttpOnly` + `SameSite=Lax` + `Secure` — workspace JS cannot read it. Verify returns 200 + `X-Authenticated-User` on valid session, 401 otherwise. No plugins required — forward_auth expands to built-in `reverse_proxy` + `handle_response` handlers. The `X-Authenticated-User` header also serves as the identity key for `caddy-ratelimit` in OAuth mode. IDEs run with auth disabled (e.g. code-server `--auth none`) — Caddy is the single auth boundary, making the IDE backend interchangeable.
- **Rate limiting via `caddy-ratelimit`** compiled into Caddy with `xcaddy`. Default policy: 60/min soft, 300/min hard for general endpoints; 10/min soft, 30/min hard for lifecycle endpoints. Identity key: authenticated user → `CF-Connecting-IP` → client IP (see [EDD 007](007_Data_Model.md)).
- **Unambiguous URL scheme**: `/api/*` for control plane, `/app/*` for SPA, `/workspace/{name}/*` for IDE sessions (srv1), `/workspace/{name}/port/{port}/*` for app previews (srv2)
- **Dynamic port forwarding**: user registers actual app ports (e.g. 3000, 5000) via API, Caddy routes created/removed on srv2, max 5 per workspace

## Appendix: Local Development Setup

### Prerequisites

- [direnv](https://direnv.net/) installed and hooked into your shell

### `.envrc`

The project uses `.envrc` (gitignored) for local environment variables. It should contain:

```bash
export TART_HOME="$PWD/.tart"
export GITHUB_OAUTH_CLIENT_ID=<client-id>
export GITHUB_OAUTH_CLIENT_SECRET=<client-secret>
```

| Variable                     | Purpose                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| `TART_HOME`                  | Stores tart VMs in `.tart/` inside the project instead of `~/.tart/` |
| `GITHUB_OAUTH_CLIENT_ID`     | GitHub OAuth App client ID                                           |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App client secret                                       |

Run `direnv allow` after creating or modifying `.envrc`.

### GitHub OAuth App

1. Go to **GitHub > Settings > Developer settings > OAuth Apps > New OAuth App**.
2. Fill in:
   - **Application name**: `Rockpool` (or any name)
   - **Homepage URL**: `http://localhost:8080`
   - **Authorization callback URL**: `http://localhost:8080/api/auth/callback`
3. Click **Register application**.
4. Copy the **Client ID** and generate a **Client Secret**.
5. Add both to `.envrc` (see above).

The callback URL is handled by the `@rockpool/auth` package in the control plane. It works on localhost — the redirect happens in the browser, so GitHub's servers don't need to reach it. No tunnel required.

For production, update the callback URL to the public domain (e.g. via Cloudflare Tunnel).

## Open Questions

- [x] How should workspace traffic be authenticated? → Cookie + forward_auth via `/api/auth/verify` on both srv1 (IDE) and srv2 (app previews). Cookie is `HttpOnly` + `SameSite=Lax` + `Secure`. IDEs run with auth disabled.
- [ ] Which GitHub OAuth scopes should be requested (e.g. `repo`, `read:org`, `read:user`)?
- [ ] Health check routes for upstreams (auto-remove dead workspaces)?

## Review Notes (Addressed)

- [x] Merge auth and proxy handlers into a single route or subroute chain → Bootstrap config uses `subroute` to nest auth inside each route's handler chain (see Bootstrap Configuration)
- [x] Add explicit matchers or redirects for bare paths without trailing slashes → Workspace routes include a `302` redirect from `/workspace/{name}` to `/workspace/{name}/` (see Workspace Routes)
- [x] Clarify rate-limit defaults here vs the data model EDD → Aligned with EDD 007: 60/min soft, 300/min hard; 10/min soft, 30/min hard for lifecycle endpoints (see Rate Limiting)
- [x] Forward `X-Forwarded-Host` and `X-Forwarded-Proto` in the auth subrequest → Added to the forward_auth JSON config (see Workspace Authentication)
- [x] Document trusted proxy headers for Cloudflare Tunnel → New Trusted Proxy Headers section with `CF-Connecting-IP`, `trusted_proxies` guidance
- [x] Redirect 401s from srv1/srv2 to a login route with return URL → forward_auth `handle_response` returns `302` to `/api/auth/github?return_to=...` on 401 (see Workspace Authentication)
