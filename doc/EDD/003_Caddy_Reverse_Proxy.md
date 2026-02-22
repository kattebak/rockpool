# EDD: Caddy Reverse Proxy Configuration

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Draft      |
| Created | 2026-02-21 |
| Updated | 2026-02-22 |

## Summary

Caddy serves as the HTTP entry point for Tidepool, running inside the root VM alongside the control plane. Traffic is split across two listeners for origin isolation: `:8080` serves the control plane API and SPA, `:8081` serves all workspace traffic. This prevents workspace-hosted JavaScript from reaching the control plane (different browser origin, no shared cookies). See [ADR-015](../ADR/015-two-port-origin-isolation.md).

The control plane configures Caddy's routes via its admin API on localhost as workspaces are created and destroyed. All routing is path-based (no subdomains). The root VM is network-isolated from the host LAN; workspace VMs are further isolated from each other.

## API Gateway Responsibilities

Caddy is the API gateway for all inbound traffic. It is responsible for:

- Basic auth (current)
- Rate limiting at the edge (see [EDD 007](007_Data_Model.md))
- Routing and path prefix handling

Rate limiting may require a Caddy module; treat it as a required gateway capability even if the first implementation is minimal.

### Rate Limiting Module Candidates

Preferred options based on popularity, fit, and stability:

- **Greenpau caddy-security** — broader gateway features with rate limiting.
- **Greenpau caddy-limiter** — focused rate limiting module.

Plan: use both. `caddy-security` covers gateway auth and broader policy, while `caddy-limiter` provides explicit rate limiting controls.

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

Control plane routes live under `srv0`, workspace routes under `srv1`.

## Origin Isolation

All traffic is split across two Caddy servers on separate ports:

| Server | Port    | Routes                | Purpose                         |
| ------ | ------- | --------------------- | ------------------------------- |
| `srv0` | `:8080` | `/api/*`, `/app/*`    | Control plane API + SPA         |
| `srv1` | `:8081` | `/workspace/{name}/*` | Workspace IDE + port forwarding |

Different ports = different browser origins. Auth cookies are scoped to `:8080` and never sent to `:8081`. The control plane never sets CORS headers for the workspace origin. This means workspace-hosted JavaScript (code-server extensions, user dev servers, compromised deps) physically cannot make credentialed requests to the control plane API.

All workspaces share `:8081`. Same-user workspaces can technically interfere with each other at the browser layer, but VM-level isolation limits the blast radius.

For external ingress, Cloudflare Tunnel maps two ingress rules to the two ports. Both `cloudflared` and Tailscale support this natively.

## Bootstrap Configuration

Load initial config via `POST /load`:

```json
{
  "apps": {
    "http": {
      "servers": {
        "srv0": {
          "listen": [":8080"],
          "routes": [
            {
              "@id": "basic-auth",
              "match": [{ "path": ["/*"] }],
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
              "@id": "control-plane",
              "match": [{ "path": ["/api/*"] }],
              "handle": [
                {
                  "handler": "reverse_proxy",
                  "upstreams": [{ "dial": "localhost:7163" }]
                }
              ],
              "terminal": true
            },
            {
              "@id": "spa",
              "match": [{ "path": ["/app/*"] }],
              "handle": [
                {
                  "handler": "reverse_proxy",
                  "upstreams": [{ "dial": "localhost:7163" }]
                }
              ],
              "terminal": true
            }
          ]
        },
        "srv1": {
          "listen": [":8081"],
          "routes": [
            {
              "@id": "workspace-auth",
              "match": [{ "path": ["/*"] }],
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
      }
    }
  }
}
```

Workspace routes are added dynamically to `srv1` (see below).

## Adding a Workspace Route

When a workspace is created, the control plane calls:

```bash
POST http://localhost:2019/config/apps/http/servers/srv1/routes

{
  "@id": "workspace-alice",
  "match": [{ "path": ["/workspace/alice/*"] }],
  "handle": [
    {
      "handler": "rewrite",
      "strip_path_prefix": "/workspace/alice"
    },
    {
      "handler": "reverse_proxy",
      "upstreams": [{ "dial": "10.0.1.50:8080" }],
      "flush_interval": -1,
      "stream_timeout": "24h",
      "stream_close_delay": "5s",
      "headers": {
        "request": {
          "set": {
            "X-Forwarded-Prefix": ["/workspace/alice"]
          }
        }
      }
    }
  ],
  "terminal": true
}
```

Key settings:

- **`strip_path_prefix`**: Removes `/workspace/alice` so the backend sees `/` as root
- **`flush_interval: -1`**: Disables buffering for low-latency terminal/IDE output
- **`stream_timeout: "24h"`**: Long-lived WebSocket connections for IDE sessions
- **`stream_close_delay: "5s"`**: Keeps WebSockets alive during config reloads
- **`X-Forwarded-Prefix`**: Tells the backend its path context

## Port Forwarding Routes

Ports are registered dynamically via the API (`POST /api/workspaces/{id}/ports`, see [EDD 007](007_Data_Model.md)). When a user registers a port, the server creates a Caddy route for it. When unregistered, the route is deleted. Up to 5 ports per workspace.

If a port is registered but no service is listening inside the VM, the proxy returns `502` until the port is live.

Port routes are nested inside the workspace route using a subroute handler. Subroutes match against the **original request path** (no rewrite has happened yet), so inner matchers use the full path. More specific port routes match first due to subroute ordering; the fallback (no matcher) handles the IDE itself.

### Workspace route (created at workspace start)

The workspace starts with just the IDE route (no port subroutes):

```json
{
  "@id": "workspace-alice",
  "match": [{ "path": ["/workspace/alice/*"] }],
  "handle": [
    {
      "handler": "subroute",
      "routes": [
        {
          "handle": [
            { "handler": "rewrite", "strip_path_prefix": "/workspace/alice" },
            {
              "handler": "reverse_proxy",
              "upstreams": [{ "dial": "10.0.1.50:8080" }],
              "flush_interval": -1,
              "stream_timeout": "24h",
              "stream_close_delay": "5s"
            }
          ]
        }
      ]
    }
  ],
  "terminal": true
}
```

### Adding a port route (on port registration)

When the user registers port 3000, a subroute is inserted before the IDE fallback:

```bash
POST http://localhost:2019/config/apps/http/servers/srv0/routes/.../routes
```

```json
{
  "@id": "workspace-alice-port-3000",
  "match": [{ "path": ["/workspace/alice/port/3000/*"] }],
  "handle": [
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
```

### Removing a port route

```bash
DELETE http://localhost:2019/id/workspace-alice-port-3000
```

### Route ID convention

- Workspace: `workspace-{name}`
- Port: `workspace-{name}-port-{port}`

````

## Removing a Workspace

Delete by `@id` (stable, not affected by array index shifts):

```bash
DELETE http://localhost:2019/id/workspace-alice
````

This removes the route and all nested subroutes.

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
    `${CADDY_ADMIN}/config/apps/http/servers/srv0/routes`,
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
| `TIDEPOOL_WORKSPACE_NAME` | `alice` | Workspace slug. Used by code-server for `--abs-proxy-base-path /workspace/alice` and by apps that need to know their URL prefix. |

The base image's code-server init script reads `TIDEPOOL_WORKSPACE_NAME` to set the base path (see [EDD 005](005_Workspace_Image_Pipeline.md)). Port forwarding is managed dynamically via the API -- apps bind to whatever port they want, then the user registers it through the control plane.

## Decisions

- **Caddy runs in the root VM** alongside the control plane — admin API on localhost only, network-isolated from host LAN
- **Two-port origin isolation**: `:8080` for control plane + SPA, `:8081` for all workspace traffic — prevents workspace JS from reaching the API ([ADR-015](../ADR/015-two-port-origin-isolation.md))
- **Basic auth in Caddy** as the initial auth mechanism; can upgrade to `forward_auth` later
- **Unambiguous URL scheme**: `/api/*` for control plane, `/app/*` for SPA, `/workspace/{name}/*` for IDE sessions
- **Dynamic port forwarding**: user registers actual app ports (e.g. 3000, 5000) via API, Caddy routes created/removed on demand, max 5 per workspace

## Open Questions

- [ ] Rate limiting on workspace routes?
- [ ] Health check routes for upstreams (auto-remove dead workspaces)?
