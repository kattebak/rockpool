# ADR-007: npm workspaces monorepo

**Date**: 2026-02-21
**Status**: Accepted

## Context

The project has multiple packages: backend services, generated code (types, schemas, OpenAPI specs), and eventually a frontend SPA. These share dependencies and build steps.

Alternatives considered:

- **Separate repos**: Harder to coordinate changes across packages, requires publishing to a registry.
- **Turborepo / Nx**: Build orchestration layers on top of workspaces. Adds complexity we don't need yet.
- **pnpm workspaces**: Viable, but npm workspaces are built-in and sufficient.

## Decision

Use **npm workspaces** with a root `package.json` that lists all packages. Generated code lives under `build/`, source packages under `packages/`.

Use `npm run <script> -w <workspace>` to run commands in specific workspaces.

## Consequences

- Single `node_modules` tree, single lock file, single `npm install`.
- Cross-package references use workspace protocol (`"workspace:*"`).
- No additional build orchestration tool needed — `make` and npm scripts handle the pipeline.
