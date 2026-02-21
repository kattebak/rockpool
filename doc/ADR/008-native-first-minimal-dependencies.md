# ADR-008: Native-first, minimal third-party dependencies

**Date**: 2026-02-21
**Status**: Accepted

## Context

Node.js has matured significantly. Many capabilities that previously required third-party packages are now built in: test runner, watch mode, env file loading, argument parsing, and more.

Every dependency is a maintenance burden: security updates, breaking changes, abandoned projects, and supply chain risk. We want to minimize the surface area.

## Decision

Prefer **Node.js built-ins and platform features** over third-party packages wherever the built-in is adequate:

- **Testing**: `node:test` + `node:assert` (no Jest, Vitest, or Mocha)
- **Watch mode**: `node --watch` (no nodemon)
- **Env files**: `node --env-file` (no dotenv)
- **Argument parsing**: `node:util.parseArgs` (no yargs, commander)

Only add a third-party dependency when the built-in doesn't exist or has a clear gap (e.g., Pino for structured logging, Zod for schema validation, Express for HTTP routing).

## Consequences

- Fewer dependencies, smaller `node_modules`, faster installs.
- Less churn from upstream breaking changes.
- Built-in APIs may be less ergonomic or feature-rich than popular libraries — we accept this trade-off.
- The `node:test` runner is sufficient for unit and integration tests; we may revisit if end-to-end testing needs arise.
