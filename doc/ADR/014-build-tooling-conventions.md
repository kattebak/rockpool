# ADR-014: Build tooling conventions — Makefile for artifacts, npm-scripts for utilities

**Date**: 2026-02-22
**Status**: Accepted

## Context

Rockpool has multiple build artifacts (VM images, TypeSpec outputs, bundled services) and operational utilities (start a VM, configure Caddy, run health checks). Without a clear convention, these end up as scattered one-liners in READMEs, undocumented shell history, or ad-hoc npm scripts.

We want a consistent answer to "how do I build X" and "how do I do Y" across the project.

## Decision

### Artifacts: Makefile

All build artifacts are defined as Makefile targets with proper dependency tracking:

```makefile
images/rockpool-workspace: images/workspace.pkr.hcl images/scripts/setup.sh
	packer build images/workspace.pkr.hcl
```

`npm run build` delegates to `make all`. Individual targets are available directly via `make`.

### Utilities: npm-scripts/

Reusable operational scripts live in `npm-scripts/` as small, self-contained bash executables. Each script:

- Has a shebang (`#!/usr/bin/env bash`)
- Is executable (`chmod +x`)
- Handles its own argument parsing and usage output
- Does one thing

Examples: `npm-scripts/caddy-add-route.sh`, `npm-scripts/wait-for-vm.sh`

These are invoked from Makefile targets, npm scripts in `package.json`, or directly.

### Bias for tools over one-offs

When a task is done more than once, it becomes a script in `npm-scripts/` or a Makefile target. README commands should reference scripts, not inline shell commands. The bar for "make it a tool" is low.

### npm scripts as entrypoints

`package.json` scripts are thin wrappers that call `make` or `npm-scripts/`:

```json
{
  "scripts": {
    "build": "make all",
    "build:image": "make images/rockpool-workspace"
  }
}
```

Use `npm run <script>` as the user-facing interface. Use `-w` for workspace-scoped scripts.

## Consequences

- Clear separation: Makefile owns the dependency graph, bash scripts own the logic.
- `make` provides incremental builds and parallelism for free.
- New contributors can run `npm run` to see all available commands, or `make -n` to see what a build will do.
- Bash scripts may need to be ported or shimmed if Windows support is ever needed — acceptable since Rockpool runs on macOS and Linux.
