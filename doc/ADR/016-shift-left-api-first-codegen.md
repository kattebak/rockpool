# ADR-016: Shift-Left API-First Code Generation

**Date**: 2026-02-22
**Status**: Proposed

## Context

Rockpool uses TypeSpec (`typespec/main.tsp`) as the single source of truth for its API and data model. The build pipeline generates five packages into `build/`:

| Package | What it generates | Actually used? |
|---------|-------------------|----------------|
| `@rockpool/openapi` | OpenAPI 3.0 YAML | Yes — `express-openapi-validator` |
| `@rockpool/validators` | Zod schemas | No |
| `@rockpool/enums` | TypeScript const objects | No |
| `@rockpool/db-schema` | Drizzle table definitions | No |
| `@rockpool/sdk` | TypeScript API client | No |

Four of five generated packages are unused. Instead, each consuming package hand-crafts its own types:

- **`packages/db/`** defines its own Drizzle schema, status enum, and inferred types
- **`packages/client/`** defines its own `Workspace`, `Port`, `WorkspaceStatus` interfaces
- **`packages/server/`** relies on implicit types from db, no validation beyond OpenAPI middleware
- **`packages/worker/`** uses none of the generated artifacts

This means the same domain model is defined in four places (TypeSpec, db schema, client types, OpenAPI spec), creating drift risk and defeating the purpose of API-first design.

Additionally, the Drizzle generator needs a configuration fix:
- `@rockpool/db-schema` currently emits PostgreSQL output (`pgTable`) because `tspconfig.yaml` is missing the `dialect: sqlite` option — the generator supports SQLite but isn't configured for it

## Decision

**TypeSpec is the single source of truth. Generated artifacts must be consumed — if we generate it, we use it. If we can't use it, we stop generating it.**

### What we generate and where it's consumed

#### Keep: `@rockpool/openapi`
Already used by `express-openapi-validator`. No change needed.

#### Keep: `@rockpool/validators`
Zod schemas generated from TypeSpec. These become the canonical runtime validation layer:

- **Server**: import and use for request/response validation (replaces implicit `req.body` destructuring)
- **Worker**: use for validating job payloads and external data at system boundaries
- **Client**: use for validating API responses at the fetch boundary

This replaces hand-written type assertions with generated, schema-accurate validation.

#### Keep: `@rockpool/enums`
The generator emits all enums in the compilation graph, including TypeSpec standard library enums (`Lifecycle`, `AuthType`, etc.) alongside domain enums. This is expected — consumers just import what they need:

- **All packages**: import `WorkspaceStatus` from `@rockpool/enums` instead of hardcoding string literals or inferring from Drizzle

#### Keep: `@rockpool/db-schema`
Fix `tspconfig.yaml` to set `dialect: sqlite` so the Drizzle generator emits `sqliteTable` instead of `pgTable`. Then:

- **`packages/db/`**: delete the hand-written schema, import table definitions from `@rockpool/db-schema` instead
- Runtime concerns like `$defaultFn` for ID generation and timestamps can be added as extensions in `packages/db/` on top of the generated base schema

#### Keep: `@rockpool/sdk`
Generated TypeScript client with proper interfaces. These become the canonical types for the client:

- **`packages/client/`**: delete hand-crafted `api-types.ts`, import types from `@rockpool/sdk` instead
- SDK models provide `Workspace`, `Port`, `WorkspaceListResponse`, `WorkspaceStatus` interfaces

### Consumption rules

1. **Types flow down from generated packages** — no hand-crafted interfaces that duplicate TypeSpec models
2. **The db package owns the database schema** — but imports enum values from `@rockpool/enums`
3. **Zod validators are used at system boundaries** — API request handling, job processing, external API responses
4. **SDK types are the client-side contract** — the client imports from `@rockpool/sdk`, not hand-written types
5. **If a generator is broken, fix it or remove it** — don't generate artifacts that sit unused

### What this looks like in practice

```
typespec/main.tsp (source of truth)
    │
    ├── build/openapi/     → packages/server (OpenAPI validator middleware)
    ├── build/validators/  → packages/server, packages/worker, packages/client (Zod validation)
    ├── build/enums/       → packages/db, packages/server, packages/worker (enum values)
    ├── build/db-schema/   → packages/db (Drizzle table definitions, dialect: sqlite)
    └── build/sdk/         → packages/client (TypeScript interfaces + API client)
```

## Consequences

**Easier:**
- Adding a new field or endpoint: change TypeSpec, run `make all`, all consumers get the update
- Type safety across the stack: drift between client, server, and worker becomes a build error
- Onboarding: one place to understand the domain model

**Harder:**
- Build dependency: source packages now depend on generated artifacts — `make all` must run before `npm run dev`
- Generator maintenance: generators need correct configuration, not ignoring
- TypeSpec becomes a bottleneck: every model change starts in `.tsp`, which requires TypeSpec knowledge

**Removed:**
- Hand-crafted schema in `packages/db/` — replaced by `@rockpool/db-schema` import
- Hand-crafted `api-types.ts` in client — replaced by SDK imports
- Hardcoded enum values — replaced by `@rockpool/enums` import
