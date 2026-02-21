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
