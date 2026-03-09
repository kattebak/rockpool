# EDD: Cloudflare Tunnel Automation in CLI

| Field        | Value                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Author       | mvhenten                                                                                                                     |
| Status       | Draft                                                                                                                        |
| Created      | 2026-03-10                                                                                                                   |
| Updated      | 2026-03-10                                                                                                                   |
| Related ADRs | [ADR-013](../ADR/013-cloudflare-tunnel-ingress.md), [ADR-015](../ADR/015-three-port-origin-isolation.md)                     |
| Related EDDs | [EDD-028](028_Cloudflare_Tunnel.md), [EDD-029](029_CLI.md)                                                                  |

## Summary

Integrate Cloudflare Tunnel management into the `rockpool` CLI. When a user provides a Cloudflare API token, `rockpool tunnel setup <domain>` creates a tunnel, configures ingress rules for all three ports, sets up DNS records, and writes the tunnel config into `rockpool.config.json`. The `rockpool run` command then automatically includes the `cloudflared` service in the generated compose file. This replaces the manual `cloudflare.sh` script workflow with a single CLI command.

## Motivation

- Current tunnel setup requires running a separate bash script, editing config files manually, and rebuilding the client.
- The CLI should be the single entry point for all stack operations including tunnels.
- With the config-driven approach from EDD-029, tunnel config should live in the same config file.

## Prerequisites

- [EDD-029: Rockpool CLI](029_CLI.md) -- the CLI this extends
- [EDD-028: Cloudflare Tunnel Support](028_Cloudflare_Tunnel.md) -- the current tunnel architecture

## Config Schema Changes

Add a `tunnel` section to the existing config schema:

```typescript
const TunnelSchema = z.object({
    domain: z.string(),
    token: z.string(),
});

export const RockpoolConfigSchema = z.object({
    // ... existing fields ...
    tunnel: TunnelSchema.optional(),
});
```

When `tunnel` is present:

- `rockpool run` includes the `cloudflared` service in the generated compose file.
- `urls` are auto-derived from the domain if not explicitly set (e.g., `ide.rockpool.example.com`, `preview.rockpool.example.com`).
- Client build uses the tunnel URLs.

The Cloudflare API credentials (`CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_ZONE_ID`) are NOT stored in the config. They are only needed during `tunnel setup` and can come from env vars or a `.cloudflare` file (already gitignored).

## CLI Commands

### `rockpool tunnel setup <domain>`

Full automated tunnel provisioning:

1. Load Cloudflare credentials from env vars or `.cloudflare` file
2. Look up zone ID from domain
3. Create a remotely-managed tunnel (`config_src: "cloudflare"`)
4. Configure ingress rules for 3 subdomains:
   - `<domain>` → `http://caddy:{ports.http}` (dashboard)
   - `ide.<domain>` → `http://caddy:{ports.ide}` (IDE)
   - `preview.<domain>` → `http://caddy:{ports.preview}` (preview)
5. Create DNS CNAME records for all 3 subdomains
6. Update `rockpool.config.json` with tunnel domain + token + urls
7. Print summary of what was created

Flags: `--api-token`, `--account-id` (to skip `.cloudflare` file)

### `rockpool tunnel teardown`

Reverse of setup:

1. Read tunnel metadata from config
2. Delete DNS records
3. Delete tunnel
4. Remove tunnel section from config

### `rockpool tunnel status`

Show tunnel connection status via API.

## Cloudflare API Integration

All API calls use `fetch()` (Node built-in) with `Authorization: Bearer {api_token}` header against `https://api.cloudflare.com/client/v4`. Required API token permissions: Cloudflare Tunnel:Edit + DNS:Edit.

### API calls used by `tunnel setup`

| Step | Method | Endpoint | Purpose |
| --- | --- | --- | --- |
| Zone lookup | `GET` | `/zones?name={baseDomain}` | Resolve zone ID from domain |
| Create tunnel | `POST` | `/accounts/{account_id}/cfd_tunnel` | Create remotely-managed tunnel with `config_src: "cloudflare"` |
| Configure ingress | `PUT` | `/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations` | Set up 3-subdomain ingress rules |
| Create DNS records | `POST` | `/zones/{zone_id}/dns_records` | CNAME records pointing to `{tunnel_id}.cfargotunnel.com` |
| Retrieve token | `GET` | `/accounts/{account_id}/cfd_tunnel/{tunnel_id}/token` | Get the tunnel token for `cloudflared` |

### API calls used by `tunnel teardown`

| Step | Method | Endpoint | Purpose |
| --- | --- | --- | --- |
| List DNS records | `GET` | `/zones/{zone_id}/dns_records?type=CNAME` | Find records to delete |
| Delete DNS records | `DELETE` | `/zones/{zone_id}/dns_records/{record_id}` | Remove CNAME records |
| Delete tunnel | `DELETE` | `/accounts/{account_id}/cfd_tunnel/{tunnel_id}` | Remove the tunnel |

### Credential loading

Credentials are resolved in this order:

1. CLI flags (`--api-token`, `--account-id`)
2. Environment variables (`CF_API_TOKEN`, `CF_ACCOUNT_ID`)
3. `.cloudflare` file in project root (key=value format, already used by `cloudflare.sh`)

Zone ID is looked up automatically from the domain via the API, so it does not need to be provided.

## Compose Generation Changes

When `config.tunnel` is present, `generateCompose()` adds the `cloudflared` service:

```typescript
cloudflared: {
    image: "docker.io/cloudflare/cloudflared:latest",
    command: "tunnel --no-autoupdate run",
    environment: {
        TUNNEL_TOKEN: config.tunnel.token,
    },
    restart: "unless-stopped",
    depends_on: ["caddy"],
}
```

When `config.tunnel` is absent, the `cloudflared` service is omitted entirely. No compose profiles needed -- the config file is the switch.

## URL Derivation

When `tunnel.domain` is set and `urls` is not explicitly provided, derive URLs:

- `urls.ide` = `https://ide.{tunnel.domain}`
- `urls.preview` = `https://preview.{tunnel.domain}`

This means `rockpool tunnel setup` followed by `rockpool run` just works -- no manual URL configuration.

Also auto-set `server.secureCookies: true` when tunnel is active (HTTPS).

```typescript
function deriveUrls(config: RockpoolConfig): { ide: string; preview: string } | undefined {
    if (config.urls) return config.urls;
    if (!config.tunnel) return undefined;

    return {
        ide: `https://ide.${config.tunnel.domain}`,
        preview: `https://preview.${config.tunnel.domain}`,
    };
}
```

## Init Integration

Add tunnel questions to `rockpool init`:

```
? Enable Cloudflare Tunnel? (y/N): y
? Domain (e.g. rockpool.example.com): rockpool.example.com
? Tunnel token (or run `rockpool tunnel setup` later):
```

If the user provides a domain but no token, `init` writes the domain to config and tells the user to run `rockpool tunnel setup` next.

Non-interactive flags: `--tunnel-domain`, `--tunnel-token`

## Migration from cloudflare.sh

The `cloudflare.sh` script (432 lines of bash) functionality moves into `packages/cli/src/commands/tunnel.ts`. Key differences:

| Aspect | `cloudflare.sh` | CLI tunnel commands |
| --- | --- | --- |
| Language | Bash + curl | TypeScript + fetch() |
| State file | `.tunnel-metadata.json` | `rockpool.config.json` (tunnel section) |
| Credentials | `.cloudflare` file only | Env vars, CLI flags, or `.cloudflare` file |
| Token storage | `.tunnel-token` file | `rockpool.config.json` (tunnel.token) |
| Compose integration | Manual `--profile tunnel` | Automatic via config-driven compose generation |
| URL config | Manual edit of config `urls` | Auto-derived from `tunnel.domain` |

The script can be deprecated once the CLI commands are verified.

## Impact on Existing Code

| File | Change |
| --- | --- |
| `packages/config/src/schema.ts` | Add `TunnelSchema` |
| `packages/cli/src/compose.ts` | Add `cloudflared` service when tunnel configured |
| `packages/cli/src/commands/tunnel.ts` | New file: `setup`, `teardown`, `status` commands |
| `packages/cli/src/commands/init.ts` | Add tunnel prompts and `--tunnel-domain`/`--tunnel-token` flags |
| `packages/cli/src/bin.ts` | Add `tunnel` command routing |

The client build requires no changes -- URL derivation feeds into the existing `urls` config field, which the client already reads via `vite.config.ts`.

## Testing Strategy

### Unit tests

- Compose generation with tunnel config produces correct `cloudflared` service definition
- Compose generation without tunnel config omits `cloudflared`
- URL derivation from `tunnel.domain` when `urls` is absent
- URL derivation skipped when `urls` is explicitly set
- Credential loading priority (flags > env > file)

### Integration

- `rockpool init --tunnel-domain example.com --tunnel-token fake` produces valid config with tunnel section
- E2E tests do not use tunnels (localhost only) and must continue to pass unaffected

### Manual

- Full tunnel lifecycle with real Cloudflare account: `tunnel setup` → `run` → verify public access → `tunnel teardown`
- Verify `tunnel status` shows connector info

## Rollout Plan

### Phase 1: Config + compose generation

1. Add `TunnelSchema` to `@rockpool/config`
2. Add `cloudflared` service to `generateCompose()` when tunnel is configured
3. Implement URL derivation from `tunnel.domain`
4. Unit tests for compose generation and URL derivation

### Phase 2: Tunnel setup/teardown/status commands

1. Implement Cloudflare API client using `fetch()`
2. Implement `tunnel setup`, `tunnel teardown`, `tunnel status` commands
3. Wire up credential loading (flags, env, `.cloudflare` file)
4. Add `tunnel` command routing in `bin.ts`

### Phase 3: Init integration + script deprecation

1. Add tunnel prompts to `rockpool init`
2. Add `--tunnel-domain` and `--tunnel-token` flags for non-interactive use
3. Deprecate `cloudflare.sh` script
4. Update documentation to reference CLI commands

## Open Questions

- [ ] **Quick tunnels.** Should we support `cloudflared tunnel --url` for ephemeral tunnels that don't need an account? Could be useful for demos: `rockpool run --quick-tunnel`.
- [ ] **Token storage.** Should the tunnel token be stored in the config file (convenient but a secret in a file) or read from an env var / keyring at runtime?
- [ ] **Plan requirements.** The three-subdomain approach (root, ide.\*, preview.\*) requires a Cloudflare plan that supports multiple CNAME records. Should we document plan requirements?
