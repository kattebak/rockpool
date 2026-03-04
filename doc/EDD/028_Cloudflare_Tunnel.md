# EDD: Cloudflare Tunnel Support

| Field        | Value                                                           |
| ------------ | --------------------------------------------------------------- |
| Author       | mvhenten                                                        |
| Status       | Draft                                                           |
| Created      | 2026-03-04                                                      |
| Updated      | 2026-03-04                                                      |
| Related EDDs | [EDD-025](025_Compose_Control_Plane.md)                         |

## Summary

Add opt-in Cloudflare Tunnel support so the Rockpool stack can be exposed publicly without opening inbound ports. A `cloudflared` compose service connects outbound to Cloudflare's edge network, which proxies incoming traffic to the three Caddy servers (dashboard, IDE, preview). The tunnel is activated via a compose profile and configured entirely through environment variables and the Cloudflare dashboard.

## Problem

The Rockpool stack currently binds to `localhost` (or VM-local ports). This makes the IDE inaccessible from outside the local network. Public access is needed for:

- **Collaboration** -- sharing a running workspace with a colleague or reviewer.
- **Mobile testing** -- previewing a web app on a phone over the internet.
- **Webhooks** -- receiving GitHub webhooks, Stripe callbacks, or other external integrations during development.
- **Remote access** -- working from a different network than where the dev machine lives.

Port forwarding through a NAT or firewall is fragile and often requires router configuration. Cloudflare Tunnel solves this by establishing an outbound connection from the developer's machine to Cloudflare's edge, which then proxies inbound traffic back through the tunnel. No inbound ports, no dynamic DNS, no firewall rules.

## Prerequisites

- A Cloudflare account with a domain (free tier is sufficient)
- A tunnel created in the Cloudflare Zero Trust dashboard
- DNS records pointing to the tunnel (created automatically by the dashboard)

## Architecture

### How Cloudflare Tunnel works

Cloudflare Tunnel (`cloudflared`) is a lightweight daemon that creates outbound-only connections to Cloudflare's edge network. The tunnel is configured with ingress rules that map public hostnames to local services. Traffic flows:

```
Browser → Cloudflare edge → cloudflared → local service
```

There are two configuration approaches:

1. **Dashboard-managed tunnel** -- create a tunnel in the Cloudflare Zero Trust dashboard, configure ingress rules there, and run `cloudflared` with just a token. The dashboard stores the config.
2. **Locally-managed tunnel** -- create a config YAML file with ingress rules and run `cloudflared` with that file.

This EDD recommends **dashboard-managed tunnels** because:

- No config file to maintain or commit (the token is the only credential)
- Ingress rules can be changed without restarting the tunnel
- The Cloudflare dashboard provides a visual editor for routes
- One fewer file to template with hostname variables

### System topology with tunnel

```
┌──────────────────────────────────────────────────────────────┐
│  Host (or Root VM)                                           │
│                                                              │
│  podman compose --profile tunnel up -d                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ compose stack                                          │  │
│  │                                                        │  │
│  │  ┌───────────┐  ┌──────────────────┐  ┌────────────┐  │  │
│  │  │  caddy     │  │  control-plane   │  │ cloudflared│  │  │
│  │  │  :8080     │  │  server  :7163   │  │            │  │  │
│  │  │  :8081     │◄─│  worker          │  │  ────────► │──┼──┼─► Cloudflare edge
│  │  │  :8082     │  │  vite    :5173   │  │            │  │  │
│  │  │  :2019     │  └──────────────────┘  └────────────┘  │  │
│  │  └─────▲──────┘  ┌──────────────────┐       │         │  │
│  │        │         │  elasticmq :9324 │       │         │  │
│  │        │         └──────────────────┘       │         │  │
│  │        └────────────────────────────────────┘         │  │
│  │        cloudflared proxies to caddy:8080/8081/8082    │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

The `cloudflared` service connects to the three Caddy listeners via compose DNS:

| Public hostname        | Tunnel ingress target | Caddy server |
| ---------------------- | --------------------- | ------------ |
| `rockpool.example.com` | `http://caddy:8080`   | srv0 (dashboard + API) |
| `ide.rockpool.example.com` | `http://caddy:8081` | srv1 (code-server IDE) |
| `preview.rockpool.example.com` | `http://caddy:8082` | srv2 (port preview) |

### Why cloudflared proxies to Caddy, not directly to control-plane

Caddy handles authentication (basic auth or OAuth), workspace routing, and TLS termination for workspace containers. Bypassing Caddy would lose all of this. The tunnel is purely a transport layer -- it replaces port forwarding, not the reverse proxy.

## Configuration

### Tunnel token (secret)

The tunnel token is a secret. It is passed as an environment variable, never stored in JSON config:

```
TUNNEL_TOKEN=eyJhIjoiNDk...
```

This is set via shell environment when starting compose, or in a `.env` file (which is gitignored).

### Public URLs in app config

When running behind a tunnel, the client needs to know the public URLs for the IDE and preview services. Without a tunnel, these default to `http://localhost:8081` and `http://localhost:8082`. With a tunnel, they are public hostnames like `https://ide.rockpool.example.com`.

These URLs are application-level configuration (they affect how the client generates links), so they belong in the JSON config schema:

```json
{
  "urls": {
    "ide": "https://ide.rockpool.example.com",
    "preview": "https://preview.rockpool.example.com"
  }
}
```

The `urls` section is optional. When omitted, the client falls back to the build-time defaults (`VITE_IDE_URL` / `VITE_PREVIEW_URL` env vars, which default to `http://localhost:8081` / `http://localhost:8082`).

When present, `urls.ide` and `urls.preview` are injected at build time into the client bundle, overriding the localhost defaults.

### Secure cookies

When running behind a tunnel with HTTPS, `server.secureCookies` should be `true` so session cookies use the `Secure` flag.

### Example tunnel config

```json
{
  "$schema": "./packages/config/rockpool.schema.json",
  "server": {
    "secureCookies": true
  },
  "auth": {
    "mode": "github",
    "github": {
      "clientId": "Iv1.abc123",
      "clientSecret": "ghp_secret",
      "callbackUrl": "https://rockpool.example.com/api/auth/callback"
    }
  },
  "urls": {
    "ide": "https://ide.rockpool.example.com",
    "preview": "https://preview.rockpool.example.com"
  },
  "spa": {
    "root": "packages/client/dist"
  }
}
```

## Compose changes

The `cloudflared` service uses a compose profile so it only starts when explicitly requested:

```yaml
services:
  cloudflared:
    image: docker.io/cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:-}
    restart: unless-stopped
    depends_on:
      - caddy
    profiles:
      - tunnel
```

The `profiles: [tunnel]` key means `cloudflared` is not started by default `podman compose up`. To start it:

```bash
podman compose --profile tunnel up -d
```

Or via npm script:

```bash
npm run start:tunnel
```

### Why `${TUNNEL_TOKEN:-}` instead of `${TUNNEL_TOKEN:?...}`

Ideally we would use `:?` to fail fast with a clear error when the token is unset. However, `podman-compose` eagerly evaluates all variable substitutions regardless of profiles, so `:?` would break `podman compose up` even when the tunnel profile is not active. Using `:-` (default to empty) avoids this. If `cloudflared` starts without a token it will fail immediately with its own error message.

## Tunnel setup guide

### 1. Create a tunnel in the Cloudflare dashboard

1. Log in to [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)
2. Navigate to **Networks > Tunnels**
3. Click **Create a tunnel**
4. Choose **Cloudflared** as the connector
5. Name the tunnel (e.g., `rockpool-dev`)
6. Copy the tunnel token (a long base64 string starting with `eyJ`)

### 2. Configure public hostnames (ingress rules)

In the tunnel configuration page, add three public hostnames:

| Public hostname              | Service           |
| ---------------------------- | ----------------- |
| `rockpool.example.com`       | `http://caddy:8080` |
| `ide.rockpool.example.com`   | `http://caddy:8081` |
| `preview.rockpool.example.com` | `http://caddy:8082` |

Replace `example.com` with your actual domain. Cloudflare will automatically create DNS CNAME records pointing to the tunnel.

### 3. Configure Rockpool

Create or update `rockpool.config.json`:

```json
{
  "$schema": "./packages/config/rockpool.schema.json",
  "server": {
    "secureCookies": true
  },
  "auth": {
    "mode": "basic",
    "basic": {
      "username": "admin",
      "password": "your-password"
    }
  },
  "urls": {
    "ide": "https://ide.rockpool.example.com",
    "preview": "https://preview.rockpool.example.com"
  },
  "spa": {
    "root": "packages/client/dist"
  }
}
```

Build the client with the tunnel URLs:

```bash
npm run build -w packages/client
```

### 4. Start the stack with the tunnel

```bash
TUNNEL_TOKEN=eyJhIjoiNDk... npm run start:tunnel
```

Or put the token in a `.env` file:

```
TUNNEL_TOKEN=eyJhIjoiNDk...
```

Then:

```bash
npm run start:tunnel
```

### 5. Verify

Open `https://rockpool.example.com` in a browser. The Caddy basic auth prompt (or GitHub OAuth redirect) should appear. After authentication, the dashboard loads at `/app/workspaces`.

## Impact on existing code

### Config schema (`packages/config/src/schema.ts`)

Add an optional `urls` section:

```typescript
const UrlsSchema = z.object({
  ide: z.string().url(),
  preview: z.string().url(),
});

export const RockpoolConfigSchema = z.object({
  // ... existing fields ...
  urls: UrlsSchema.optional(),
});
```

The `urls` section is optional -- when absent, the system uses localhost defaults. This preserves backward compatibility with existing config files.

### Client build (`packages/client/vite.config.ts`)

When `ROCKPOOL_CONFIG` is set and the config contains `urls`, Vite uses those values instead of the `VITE_IDE_URL` / `VITE_PREVIEW_URL` env vars:

```typescript
const ideUrl = config?.urls?.ide ?? process.env.VITE_IDE_URL ?? "http://localhost:8081";
const previewUrl = config?.urls?.preview ?? process.env.VITE_PREVIEW_URL ?? "http://localhost:8082";
```

### npm scripts (`package.json`)

Add a tunnel start script:

```json
{
  "start:tunnel": "make .stamps/rockpool-workspace-container && npm run build -w packages/client && npm-scripts/podman.sh --profile tunnel up -d"
}
```

### No server-side changes needed

The server does not generate IDE or preview URLs. These are purely client-side constructs built from the `__IDE_URL__` and `__PREVIEW_URL__` compile-time constants. Caddy handles all routing regardless of whether traffic arrives from localhost or a tunnel.

## Testing

The tunnel feature is opt-in and does not affect the default compose profile. Existing E2E tests continue to run against localhost ports without a tunnel. No new E2E tests are needed for the tunnel itself -- it is a transport-layer feature verified manually.

Unit tests for the config schema should cover the optional `urls` section:

- Schema parses with `urls` present
- Schema parses without `urls` (backward compatibility)
- Schema rejects malformed URLs

## Security considerations

- The tunnel token is a secret that grants control of the tunnel. Treat it like a password.
- Always use authentication (basic or OAuth) when exposing the stack publicly. The Caddy auth layer applies regardless of transport.
- Consider enabling `secureCookies: true` when running over HTTPS via the tunnel.
- The `cloudflared` image is pulled from Docker Hub. Pin to a specific digest for production deployments.

## Alternatives considered

### ngrok

Similar tunnel service. Disadvantages: paid for custom domains, rate limits on free tier, no DNS integration. Cloudflare Tunnel is free with a Cloudflare domain.

### Tailscale Funnel

Exposes services via Tailscale's mesh network. Disadvantages: requires Tailscale on the client, custom domains require paid plan.

### Manual port forwarding

Fragile, requires router access, does not work on many corporate or mobile networks. No TLS unless separately configured.

## Appendix: complete compose.yaml with tunnel

For reference, the tunnel service added to the existing compose.yaml:

```yaml
services:
  # ... existing services (caddy, elasticmq, control-plane) ...

  cloudflared:
    image: docker.io/cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:-}
    restart: unless-stopped
    depends_on:
      - caddy
    profiles:
      - tunnel
```
