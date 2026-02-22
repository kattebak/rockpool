# Rockpool

Cloud9-style cloud IDE — isolated microVM workspaces behind Caddy reverse proxy.

## Structure

- `typespec/main.tsp` — source of truth for API models and routes
- `build/` — generated packages (`@rockpool/openapi`, `@rockpool/validators`, `@rockpool/enums`, `@rockpool/db-schema`). Do not edit.
- `packages/` — source code (npm workspaces): `server`, `worker`, `db`, `queue`, `runtime`, `caddy`
- `doc/ADR/` — Architecture Decision Records. `doc/EDD/` — Engineering Design Documents.
- `npm-scripts/` — operational shell scripts. `Makefile` — build artifacts.

## Stack

Node >= 22, ES modules only, strict TypeScript. Express + express-openapi-validator. SQLite + Drizzle ORM. Biome for lint/format. `node:test` for testing. Prefer Node.js built-ins over third-party packages.

## Rules

- `.claude/rules/typescript.md` — type safety, error handling, code style
- `.claude/rules/development.md` — workspace commands, build tooling conventions

## Copilot Guidance

GitHub Copilot (Codex) should treat `.claude/` as the canonical source for rules and skills. Read and follow `.claude/rules/*` and `.claude/skills/*` before making changes.
