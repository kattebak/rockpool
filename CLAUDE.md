# Tidepool

Cloud9-style cloud IDE — isolated microVM workspaces behind Caddy reverse proxy.

## Workflow

Do NOT use `EnterPlanMode`. Use the **architect** agent for multi-step work, **developer** agent for concrete tasks. Proceed autonomously.

## Structure

- `typespec/main.tsp` → `build/` (`@tdpl/openapi`, `@tdpl/validators`, `@tdpl/enums`, `@tdpl/db-schema`) — generated, do not edit
- `packages/` — source: `server`, `worker`, `db`, `queue`, `runtime`, `caddy`
- `doc/ADR/`, `doc/EDD/` — design docs, read before architectural changes
- `npm-scripts/` — operational scripts
- `Makefile` — build artifacts (`make all`)

## Rules

- Coding standards: `.claude/rules/typescript.md`, `.claude/rules/development.md`
- Agent details: `.claude/agents/architect.md`, `.claude/agents/developer.md`
- Scope: `@tdpl/*`, path-based routing only, Node >= 22, ES modules
