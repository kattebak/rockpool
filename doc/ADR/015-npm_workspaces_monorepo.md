# Use npm workspaces for monorepo structure

## Status

_accepted_

## Context

A serverless application typically consists of multiple packages: infrastructure (CDK), backend (Lambda handlers), frontend (SPA), and generated packages (types, schemas). These packages share dependencies and need coordinated versioning.

### Options considered

#### Separate repositories

Each package lives in its own repository with independent versioning.

Pros:

- Clear ownership boundaries
- Independent release cycles

Cons:

- Cross-repository changes require multiple PRs
- Dependency version drift
- Complex CI/CD coordination
- Type sharing requires publishing packages

#### Monorepo with npm workspaces

All packages in a single repository using npm's built-in workspace feature.

Pros:

- Atomic commits across packages
- Shared dependency versions
- Single CI/CD pipeline
- Direct package references without publishing
- Native npm feature, no additional tooling

Cons:

- Larger repository size
- All changes visible to all contributors

#### Monorepo with specialized tools (Nx, Turborepo, Lerna)

Use dedicated monorepo tooling for advanced features.

Pros:

- Incremental builds
- Dependency graph visualization
- Remote caching

Cons:

- Additional tooling complexity
- Learning curve
- May be overkill for smaller teams

## Decision

- Use npm workspaces for monorepo structure
- All application packages live under `packages/`
- Generated packages live under `build/` (gitignored)
- Infrastructure code lives under `src/`

Repository structure:

```
project-root/
├── package.json          # Root workspace config
├── src/                  # CDK infrastructure (not a workspace)
├── packages/
│   ├── backend/          # Lambda handlers
│   └── frontend/         # React SPA
├── build/                # Generated packages (gitignored)
│   ├── openapi3/
│   ├── ddb-entities/
│   └── zod-schemas/
└── typespec/             # API definitions
```

Workspace configuration:

```json
{
  "workspaces": [
    "packages/*",
    "build/*"
  ]
}
```

## Consequences

- Single `npm install` installs all dependencies
- Workspace packages reference each other directly
- Generated packages are available immediately after build
- No need for publishing internal packages
- CI/CD pipeline builds and tests everything together
- May need to adopt Turborepo or Nx if build times become problematic at scale
