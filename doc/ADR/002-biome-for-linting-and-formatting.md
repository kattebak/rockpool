# ADR-002: Use Biome for linting and formatting

**Date**: 2026-02-21
**Status**: Accepted

## Context

We need a linter and formatter for TypeScript, JavaScript, and JSON. The traditional stack is ESLint + Prettier, which requires two tools, a compatibility plugin (`eslint-config-prettier`), and many config files.

Biome is a single Rust-based tool that handles both linting and formatting with a single config file, fast execution, and sensible defaults.

## Decision

Use **Biome** as the sole linter and formatter. No ESLint, no Prettier.

Configuration: tab indentation, 100-char line width, auto-organized imports, and strict naming conventions (camelCase for variables, PascalCase for types, CONSTANT_CASE for constants).

## Consequences

- One tool, one config file (`biome.json`), one set of rules.
- Faster than ESLint + Prettier combined.
- Biome's rule set is smaller than ESLint's ecosystem of plugins — we accept this trade-off in exchange for simplicity.
