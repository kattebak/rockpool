# Rockpool

Cloud9-style cloud IDE — isolated microVM workspaces behind Caddy reverse proxy.

## Workflow

Do NOT use `EnterPlanMode`. Use the **architect** agent for multi-step work, **developer** agent for concrete tasks. Proceed autonomously.

## Structure

- `typespec/main.tsp` → `build/` (`@rockpool/openapi`, `@rockpool/validators`, `@rockpool/enums`, `@rockpool/db-schema`) — generated, do not edit
- `packages/` — source: `server`, `worker`, `db`, `queue`, `runtime`, `caddy`
- `doc/ADR/`, `doc/EDD/` — design docs, read before architectural changes
- `npm-scripts/` — operational scripts
- `Makefile` — build artifacts (`make all`)

## Verification

After changes to API routes, server logic, UI components, or frontend UX, run the headless E2E tests:

```bash
npm run test:e2e:headless
```

## Rules

- Coding standards: `.claude/rules/typescript.md`, `.claude/rules/development.md`
- Agent details: `.claude/agents/architect.md`, `.claude/agents/developer.md`
- Scope: `@rockpool/*`, path-based routing only, Node >= 22, ES modules
