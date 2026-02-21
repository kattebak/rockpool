# ADR-001: Use express-openapi-validator for API routing and validation

**Date**: 2026-02-21
**Status**: Accepted

## Context

This project uses TypeSpec to define APIs, which compiles to OpenAPI 3.x specs, Zod schemas, and TypeScript types. We need a spec-first framework that reads the generated OpenAPI JSON and provides automatic request validation, response validation, and operationId-based routing.

We previously used `openapi-backend` across several projects. That project is no longer actively maintained.

Alternatives considered:

- **Hono + @hono/zod-openapi**: Code-first (you write Zod route definitions and it generates the spec). Backwards from our pipeline where TypeSpec is the source of truth.
- **tsoa**: Code-first with TypeScript decorators. Same problem.
- **Raw Express + manual validation**: No auto-routing, no spec-driven validation.

## Decision

Use **express-openapi-validator** as the API framework layer. It reads the OpenAPI JSON directly, auto-validates requests and responses, and maps operationId to handler functions via `x-eov-operation-handler` extensions.

```
TypeSpec → OpenAPI JSON    → express-openapi-validator (routing + validation)
        → Zod schemas     → domain validation in handlers
        → TypeScript types → handler type safety
```

## Consequences

- Backend services use Express as the HTTP server.
- The generated OpenAPI spec is the single source of truth for routing and validation.
- Handler files are organized by operation and auto-discovered by the framework.
- Response validation can be toggled per environment.
