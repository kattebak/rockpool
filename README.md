# Rockpool

Cloud IDE platform. Isolated development environments in Podman containers, accessible via browser.

## Architecture

- **Workspaces**: Podman rootless containers running Debian with code-server
- **Reverse proxy**: Caddy with path-based routing, dynamically configured via admin API
- **Control plane**: Workspace Service (CRUD), Caddy Service (routing), Workspace Worker (async jobs via ElasticMQ)
- **Frontend**: React SPA for workspace management

See [doc/EDD/](doc/EDD/) for detailed design documents and [doc/ADR/](doc/ADR/) for technology decisions.

## Tech Stack

| Layer    | Technology                                                |
| -------- | --------------------------------------------------------- |
| API spec | TypeSpec -> OpenAPI, Zod, TypeScript types, Drizzle tables |
| Backend  | Express + express-openapi-validator                       |
| Database | SQLite + Drizzle ORM                                      |
| Frontend | React, shadcn/ui, TanStack Query/Router                   |
| Runtime  | Node.js >= 22, ES modules                                 |
| Containers | Podman rootless workspaces                              |
| Tooling  | Biome (lint/format), esbuild (bundle), node:test          |

## Quick Start

```sh
make rockpool.config.json              # creates config from example template
npm install                            # builds TypeSpec, SDK
npm start                              # starts stack via podman compose
```

`npm start` starts the full stack (ElasticMQ, Caddy, API server, worker, Vite dev server) via Podman Compose.

Node.js `--watch` restarts the server automatically on file changes.

The dashboard is at `http://localhost:8080/app/workspaces`.

## Configuration

Rockpool uses JSON config files for application settings (auth, feature flags) validated by a zod schema (`@rockpool/config`). Infrastructure topology (hostnames, ports, service URLs) is configured via compose environment variables.

| File | Purpose | Committed |
|------|---------|-----------|
| `rockpool.config.example.json` | Template for local dev | Yes |
| `rockpool.config.json` | Local dev config (gitignored) | No |
| `rockpool.test.config.json` | E2E test profile | Yes |

Either GitHub OAuth **or** basic auth credentials must be configured in the `auth` section. See [doc/EDD/003_Caddy_Reverse_Proxy.md](doc/EDD/003_Caddy_Reverse_Proxy.md) appendix for GitHub OAuth setup.

## Development

Requires Node.js >= 22.

```sh
npm install
npm run lint
npm run check
npm test
```

### Useful commands

```sh
npm start                          # start stack via podman compose
npm stop                           # stop compose stack
npm run logs                       # tail compose logs
npm test                           # run unit tests across all packages
npm run fix -- --unsafe            # format and lint
```

### Building the workspace image

```sh
podman build -t rockpool-workspace:latest images/workspace/
```

### E2E tests

```sh
npm run test:e2e:headless          # real Podman containers, headless Playwright
```
