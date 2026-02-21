# ADR-009: SQLite with Drizzle ORM

**Date**: 2026-02-21
**Status**: Accepted

## Context

The control plane needs a database for workspace metadata, user state, and configuration. The system is self-hosted on a single server (or small cluster), not a cloud environment.

Requirements:

- Runs locally with zero infrastructure (no separate database server).
- Supports typed queries that align with our TypeSpec-generated interfaces.
- Simple enough to embed in the control plane VM.

Alternatives considered:

- **PostgreSQL**: Requires running a separate server. More operational overhead than needed.
- **Prisma**: Heavy ORM with its own schema language. Duplicates what TypeSpec already defines.

## Decision

Use **SQLite** as the database (via `better-sqlite3`) and **Drizzle ORM** as the query layer.

Table definitions are generated from TypeSpec using [`@kattebak/typespec-drizzle-orm-generator`](https://github.com/kattebak/typespec-drizzle-orm-generator), keeping the API spec and database schema in sync.

```
TypeSpec → Drizzle table definitions → SQLite
        → OpenAPI / Zod / Types (as before)
```

## Consequences

- Zero-infrastructure database: SQLite is a single file on disk, backed up by copying the file.
- Drizzle provides typed queries that match the generated TypeSpec interfaces — no manual mapping.
- Schema migrations are handled by `drizzle-kit`.
- SQLite is single-writer; sufficient for the control plane's concurrency needs. If write contention becomes an issue, we can switch to PostgreSQL with minimal Drizzle ORM changes.
