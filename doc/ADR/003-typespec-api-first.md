# ADR-003: TypeSpec as the API specification language

**Date**: 2026-02-21
**Status**: Accepted

## Context

We need a single source of truth for API definitions that generates OpenAPI specs, TypeScript types, Zod validation schemas, and database entity definitions. Writing these by hand leads to drift.

Alternatives considered:

- **Hand-written OpenAPI YAML**: Verbose, error-prone, no type generation without extra tooling.
- **Code-first (tsoa, Hono)**: TypeScript decorators or Zod schemas as source of truth. Ties the spec to the framework and makes it harder to generate artifacts for other consumers.

## Decision

Use **TypeSpec** as the API definition language. The build pipeline compiles TypeSpec into:

- OpenAPI 3.x JSON (for express-openapi-validator routing)
- Zod schemas (for domain validation)
- TypeScript types (for handler type safety)
- Drizzle ORM table definitions (for database schema)

Custom emitters from the `@kattebak` namespace handle Zod and Drizzle generation.

## Consequences

- API shape is defined once in TypeSpec; all downstream artifacts are generated.
- Adding a new API field propagates automatically to validation, types, and database schema.
- Contributors must learn TypeSpec syntax (small learning curve, similar to TypeScript interfaces).
- Build step required before type-checking or running the server (`npm run build:typespec`).
