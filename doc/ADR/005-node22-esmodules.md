# ADR-005: Node.js >= 22 with ES modules

**Date**: 2026-02-21
**Status**: Accepted

## Context

We need to choose a Node.js version floor and module system. The project targets self-hosted servers (not Lambda or shared hosting), so we control the runtime.

Node.js 22 is the current LTS and provides stable ES module support, a built-in test runner, native `--watch`, `--env-file`, and other features that reduce third-party dependencies.

## Decision

Require **Node.js >= 22**. Use **ES modules** throughout (`"type": "module"` in package.json, `"module": "NodeNext"` in tsconfig).

No CommonJS compatibility shims. All packages in the monorepo are ESM-only.

## Consequences

- Access to modern Node.js built-ins (test runner, watch mode, env file loading, etc.).
- Some older npm packages that are CJS-only may need dynamic `import()` or replacements.
- No ambiguity about module resolution — everything is ESM with explicit `.js` extensions in imports.
