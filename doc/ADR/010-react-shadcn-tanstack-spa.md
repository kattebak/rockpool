# ADR-010: React + shadcn/ui + TanStack for the SPA frontend

**Date**: 2026-02-21
**Status**: Accepted

## Context

The control plane needs a web UI for managing workspaces (create, list, start, stop, open IDE). This is a single-page application served alongside the API.

Requirements:

- Type-safe data fetching that integrates with our OpenAPI-generated types.
- Client-side routing (the app is served from a single entry point behind Caddy).
- Component library that doesn't impose heavy runtime dependencies.

## Decision

Use **React** with:

- **shadcn/ui** for UI components (copy-paste, not a dependency — components live in the codebase).
- **TanStack React Query** for server state management and data fetching.
- **TanStack Router** for type-safe client-side routing.

The frontend uses **Vite** as the build tool and dev server, and **Vitest** for testing.

## Consequences

- shadcn/ui components are owned source code, not a library version to track. Full control over styling and behavior.
- TanStack Query handles caching, background refetching, and optimistic updates out of the box.
- TanStack Router provides type-safe route params and search params, catching routing errors at compile time.
- React is well-understood and has the largest ecosystem for hiring and component availability.
- Vite provides fast HMR during development and optimized production builds.
- Vitest shares the Vite config and transform pipeline, so tests run against the same module resolution and transforms as the app itself.
