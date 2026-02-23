# EDD: Vite Migration for @rockpool/client

| Field        | Value                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Author       | Claude                                                                                                     |
| Status       | Implemented                                                                                                |
| Created      | 2026-02-23                                                                                                 |
| Updated      | 2026-02-23                                                                                                 |
| Related ADRs | [ADR-010](../ADR/010-react-shadcn-tanstack-spa.md), [ADR-016](../ADR/016-shift-left-api-first-codegen.md) |

## Summary

Replace the custom esbuild build and dev-server in `packages/client/` with Vite + Vitest. All existing components, routes, hooks, and styles are preserved — this changes only the build infrastructure. Production deployment is out of scope and will be designed separately.

## Prerequisites

- [ADR-010: React + shadcn/ui + TanStack SPA](../ADR/010-react-shadcn-tanstack-spa.md) (updated to specify Vite/Vitest)
- [EDD-009: UX Mockups and Guidelines](009_UX_Mockups_Guidelines.md)

## Goals

- Replace `src/build.ts` and `src/dev-server.ts` with `vite.config.ts`
- Get Vite dev server with HMR and API proxy working
- Add Vitest as the test runner
- Preserve all existing UX, components, and hooks unchanged
- Remove the pre-built client bundle from the dev/start flow

## Non-Goals

- Production build/deployment pipeline (design separately)
- Adopting TanStack Router file-based routing (keep manual route tree for now)
- Consuming `@rockpool/sdk` types (ADR-016 — separate work)
- Adding React component tests (future — this EDD sets up Vitest, not the test suite)
- Changing the app's behavior, routes, or components

## What Was Deleted

| File | Purpose | Replaced By |
| --- | --- | --- |
| `src/build.ts` | Custom esbuild production build | `vite build` (to `dist/`) |
| `src/dev-server.ts` | Custom Node.js dev server + esbuild context + API proxy | `vite` with proxy config |
| `public/index.html` | Static HTML, manually copied to build output | `index.html` at package root (Vite convention) |
| Makefile `build-client` target | Pre-built client bundle as part of `make all` | Removed — dev uses Vite dev server |

## What Was Added

| File | Purpose |
| --- | --- |
| `vite.config.ts` | Vite config: dev server, proxy, path aliases, Vitest config |
| `index.html` | Entry point at package root (Vite resolves `<script>` tags from here) |

## Implementation

### Dependencies

Removed:
- `esbuild`
- `esbuild-plugin-tailwindcss`

Added (dev):
- `vite`
- `@vitejs/plugin-react`
- `vitest`
- `jsdom`
- `@testing-library/react`
- `@testing-library/jest-dom`

Kept (unchanged):
- `tailwindcss`, `postcss`, `@tailwindcss/postcss` — Vite uses PostCSS natively

### `vite.config.ts`

```typescript
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/app/",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:7163",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
  },
});
```

Key decisions:
- `base: "/app/"` — matches the existing `/app` basepath from TanStack Router and Caddy routing
- Proxy `/api` to backend — replaces the hand-rolled proxy in `dev-server.ts`
- Vitest config is inline (single file, no divergence needed)
- No custom `build.outDir` — defaults to `dist/`, production deployment designed separately

### `index.html`

Moved from `public/index.html` to package root. Vite injects script/style tags automatically:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rockpool</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `package.json` scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### Root `package.json` changes

Removed `npm run build -w packages/client &&` prefix from:
- `start` script
- `dev:caddy` script

These scripts no longer pre-build the client — the Vite dev server is managed by PM2 in dev mode, and production deployment is out of scope.

### Makefile changes

Removed the `build-client` target and its dependency from `all`. The Makefile now only builds generated artifacts (TypeSpec, OpenAPI, SDK).

### Integration points (unchanged)

- **PM2 ecosystem config** — `npm run dev -w packages/client` now invokes `vite` instead of the custom dev server. Same port (5173), no config change.
- **Caddy** — No change. Caddy proxies to the server, not the client dev server.
- **shadcn/ui CLI** — `components.json` unchanged. `rsc: false` and path aliases work with Vite.

## Verification

- `npm run dev -w packages/client` — Vite dev server starts on :5173
- `npm run build -w packages/client` — produces `dist/` with hashed assets
- `npm run test -w packages/client` — Vitest runs (passes with no tests)
- `npm run check -w packages/client` — tsc passes
- Path alias `@/` resolves in dev, build, and test
