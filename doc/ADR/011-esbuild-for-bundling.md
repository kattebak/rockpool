# ADR-011: esbuild for bundling

**Date**: 2026-02-21
**Status**: Accepted

## Context

We need a bundler for backend services (single-file deployment bundles) and eventually the frontend SPA. The bundler should be fast and require minimal configuration.

Alternatives considered:

- **tsc**: Type-checks but doesn't bundle. Output is many files, not deployable as-is.
- **Rollup / Webpack**: Feature-rich but slow and config-heavy for our needs.
- **swc**: Fast transpiler but less mature bundling story.

## Decision

Use **esbuild** for bundling backend services and the frontend SPA.

## Consequences

- Sub-second builds for backend bundles.
- Minimal config (a few flags or a short build script).
- esbuild does not type-check — we rely on `tsc --noEmit` (or `tsgo`) for that. Build and type-check are separate steps.
