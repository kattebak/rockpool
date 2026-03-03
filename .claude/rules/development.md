# Development Workflow

**Never run podman, tsx, vite, or other tools directly.** Use `npm run <script>` instead.

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

## Git Worktrees for Parallel Work

Use git worktrees to parallelise independent work on the same codebase. Each worktree is a separate checkout on its own branch, sharing the same `.git` history.

When delegating tasks via the Agent tool, use `isolation: "worktree"` for work that is independent of the current working tree. This lets multiple agents work in parallel without interfering with each other or the user's main checkout.

Good candidates for worktree isolation:
- Independent features or refactors that touch different files
- Exploratory spikes that may be discarded
- Long-running tasks (e.g., large refactors) while the main checkout stays usable

Not suitable for worktree isolation:
- Tasks that depend on uncommitted changes in the main checkout
- Sequential tasks where one builds on the output of the previous
