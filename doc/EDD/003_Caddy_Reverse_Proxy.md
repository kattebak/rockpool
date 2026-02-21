# EDD: Caddy Reverse Proxy Configuration

| Field   | Value      |
| ------- | ---------- |
| Author  | mvhenten   |
| Status  | Draft      |
| Created | 2026-02-21 |
| Updated | 2026-02-21 |

## Summary

Caddy serves as the single HTTP entry point for Tidepool. The control plane dynamically configures Caddy's routes via its admin API as workspaces are created and destroyed. All routing is path-based (no subdomains).

## Admin API Basics

Caddy exposes a REST API on `localhost:2019` by default.

| Method   | Endpoint          | Behavior                              |
| -------- | ----------------- | ------------------------------------- |
| `GET`    | `/config/[path]`  | Read config at path                   |
| `POST`   | `/config/[path]`  | Append to arrays, create objects      |
| `PUT`    | `/config/[path]`  | Insert at position or create          |
| `PATCH`  | `/config/[path]`  | Replace existing values               |
| `DELETE` | `/config/[path]`  | Remove config at path                 |
| `DELETE` | `/id/{id}`        | Remove object by `@id` (preferred)    |

Config tree path: `apps.http.servers.{serverName}.routes[index]`

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
              "@id": "control-plane",
              "match": [{ "path": ["/api/*"] }],
              "handle": [{
                "handler": "reverse_proxy",
                "upstreams": [{ "dial": "CONTROL_PLANE_IP:3000" }]
              }],
              "terminal": true
            },
            {
              "@id": "spa",
              "match": [{ "path": ["/*"] }],
              "handle": [{
                "handler": "reverse_proxy",
                "upstreams": [{ "dial": "CONTROL_PLANE_IP:3000" }]
              }]
            }
          ]
        }
      }
    }
  }
}
```

## Adding a Workspace Route

When a workspace is created, the control plane calls:

```bash
POST http://localhost:2019/config/apps/http/servers/srv0/routes

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

For `/workspace/alice/port/3000/*` proxying to VM port 3000:

```json
{
  "@id": "workspace-alice-port-3000",
  "match": [{ "path": ["/workspace/alice/port/3000/*"] }],
  "handle": [
    {
      "handler": "rewrite",
      "strip_path_prefix": "/workspace/alice/port/3000"
    },
    {
      "handler": "reverse_proxy",
      "upstreams": [{ "dial": "10.0.1.50:3000" }],
      "flush_interval": -1,
      "stream_timeout": "24h",
      "stream_close_delay": "5s"
    }
  ],
  "terminal": true
}
```

### Route Ordering

Port-specific routes MUST match before the general workspace route (more specific first). Two strategies:

**Strategy A: Insert at index 0** using `PUT /config/.../routes/0`

**Strategy B: Subroutes** (preferred) -- nest port routes inside the workspace route handler:

```json
{
  "@id": "workspace-alice",
  "match": [{ "path": ["/workspace/alice/*"] }],
  "handle": [{
    "handler": "subroute",
    "routes": [
      {
        "@id": "workspace-alice-port-3000",
        "match": [{ "path": ["/workspace/alice/port/3000/*"] }],
        "handle": [
          { "handler": "rewrite", "strip_path_prefix": "/workspace/alice/port/3000" },
          { "handler": "reverse_proxy", "upstreams": [{ "dial": "10.0.1.50:3000" }], "flush_interval": -1 }
        ],
        "terminal": true
      },
      {
        "handle": [
          { "handler": "rewrite", "strip_path_prefix": "/workspace/alice" },
          { "handler": "reverse_proxy", "upstreams": [{ "dial": "10.0.1.50:8080" }], "flush_interval": -1, "stream_timeout": "24h" }
        ]
      }
    ]
  }],
  "terminal": true
}
```

## Removing a Workspace

Delete by `@id` (stable, not affected by array index shifts):

```bash
DELETE http://localhost:2019/id/workspace-alice
```

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
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(route) }
  );
  if (!response.ok) throw new Error(`Caddy: ${response.status} ${await response.text()}`);
}

async function removeRoute(id: string): Promise<void> {
  const response = await fetch(`${CADDY_ADMIN}/id/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`Caddy: ${response.status}`);
}
```

## Concurrency

Use `ETag`/`If-Match` headers for optimistic concurrency when multiple requests may modify config simultaneously. GET returns an `ETag`, pass it as `If-Match` on mutations.

## Open Questions

- [ ] Should Caddy run on the host or inside a VM?
- [ ] Auth middleware in Caddy (forward_auth) or in the control plane?
- [ ] Rate limiting on workspace routes?
- [ ] Health check routes for upstreams (auto-remove dead workspaces)?
