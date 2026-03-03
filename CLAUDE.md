# Rockpool

Cloud9-style cloud IDE — isolated container workspaces behind Caddy reverse proxy.

## Workflow

Do NOT use `EnterPlanMode`. Use the **architect** agent for multi-step work, **developer** agent for concrete tasks. Proceed autonomously.

## Structure

- `typespec/main.tsp` → `build/` (`@rockpool/openapi`, `@rockpool/validators`, `@rockpool/enums`, `@rockpool/db-schema`) — generated, do not edit
- `packages/` — source: `server`, `worker`, `db`, `queue`, `runtime`, `caddy`
- `doc/ADR/`, `doc/EDD/` — design docs, read before architectural changes
- `npm-scripts/` — operational scripts
- `Makefile` — build artifacts (`make all`)

## Stack Management

The entire stack runs via podman compose:

```bash
npm start              # start all services (caddy, server, worker, elasticmq, client)
npm stop               # stop all services
npm run logs           # tail compose logs (pass -- --no-follow for snapshot)
```

Container naming follows the `${name}-${id}` pattern. Health checks use native `fetch()` with `AbortSignal.timeout`.

## Debugging

Always check compose logs for crashes **before** investigating symptoms:

```bash
npm run logs -- --tail 50 --no-follow
```

Look for crash loops, ReferenceErrors, unhandled rejections, and connection failures. Fix crashes before investigating 502s or other symptoms.

## Testing

- **E2E**: 37 Playwright tests against real containers via compose (`npm run test:e2e:headless`)
- **Unit**: `npm test` runs tests across all workspaces
- Test profile uses separate ports/DB so it does not interfere with development

## Verification

After making code changes, always run the formatter/linter before committing:

```bash
npm run fix -- --unsafe
```

After changes to API routes, server logic, UI components, or frontend UX, run the headless E2E tests:

```bash
npm run test:e2e:headless
```

## Rules

- Coding standards: `.claude/rules/typescript.md`, `.claude/rules/development.md`
- Agent details: `.claude/agents/architect.md`, `.claude/agents/developer.md`
- Scope: `@rockpool/*`, path-based routing only, Node >= 22, ES modules
