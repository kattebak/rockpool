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
