# Development Workflow

**Never run pm2, tsx, vite, or other tools directly.** Use `npm run <script>` instead.

Run `npm run` to see all available scripts.

If a script doesn't exist, add it to package.json.

## Workspace Commands

Use the `-w` flag to run scripts in specific workspaces instead of `cd`:

```bash
# Good - use workspace flag
npm run build:search-index -w server
npm run dev -w client

# Bad - don't cd into directories
cd server && npm run build:search-index
```

## Build Tooling Conventions

See [ADR-014](../../doc/ADR/014-build-tooling-conventions.md) for full rationale.

### Artifacts go in Makefile

Build artifacts (images, generated code, bundles) are Makefile targets with dependency tracking. `npm run build` delegates to `make all`.

### Utilities go in npm-scripts/

Reusable operational scripts live in `npm-scripts/` as executable bash scripts. Each script does one thing and handles its own usage output.

### Bias for tools over one-offs

If a task is done more than once, make it a script. README commands should reference scripts, not inline shell. The bar for "make it a tool" is low.
