# Tidepool

Cloud IDE platform. Isolated development environments in microVMs, accessible via browser.

## Architecture

- **Workspace VMs**: Tart (macOS) / Incus (Linux) microVMs running Alpine Linux with code-server
- **Reverse proxy**: Caddy with path-based routing, dynamically configured via admin API
- **Control plane**: Workspace Service (CRUD), Caddy Service (routing), Workspace Worker (async jobs via ElasticMQ)
- **Frontend**: React SPA for workspace management

See [doc/EDD/](doc/EDD/) for detailed design documents and [doc/ADR/](doc/ADR/) for technology decisions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API spec | TypeSpec → OpenAPI, Zod, TypeScript types, Drizzle tables |
| Backend | Express + express-openapi-validator |
| Database | SQLite + Drizzle ORM |
| Frontend | React, shadcn/ui, TanStack Query/Router |
| Runtime | Node.js >= 22, ES modules |
| Tooling | Biome (lint/format), esbuild (bundle), node:test |

## Development

```sh
npm install
npm run lint
npm run check
npm test
```

Requires Node.js >= 22.

## MVP (local macOS, Tart + Caddy)

This is the vertical slice described in [doc/EDD/006_Vertical_Slice_MVP.md](doc/EDD/006_Vertical_Slice_MVP.md).

1. Start a VM from a local base image (prints VM IP):
	- `npm run mvp:start-vm`
2. Configure code-server inside the VM:
	- `npm run mvp:setup-vm`
3. Start Caddy on the host and load a minimal config:
	- `caddy start`
	- `npm run mvp:caddy:bootstrap`
4. Add a workspace route (replace VM IP):
	- `npm run mvp:caddy:add-route -- -n test -i <VM_IP>`
5. Open `http://localhost:8080/workspace/test/`

If you want to use the custom Alpine image, run `npm run mvp:build-image` first and pass its name to `mvp:start-vm` with `-i`.
