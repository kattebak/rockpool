# Use Biome for linting and formatting

## Status

_accepted_

## Context

Code linting and formatting ensure consistent code style and catch common errors. The JavaScript/TypeScript ecosystem has several options.

### Options considered

#### ESLint + Prettier

The traditional combination: ESLint for linting, Prettier for formatting.

Pros:

- Mature ecosystem with extensive plugin support
- Highly configurable
- Industry standard

Cons:

- Two tools to configure and maintain
- Slower performance (JavaScript-based)
- Configuration complexity (eslint-config-prettier, plugin conflicts)
- Ongoing maintenance of plugin versions

#### ESLint (with stylistic rules)

ESLint alone with formatting rules enabled.

Pros:

- Single tool
- Full ecosystem access

Cons:

- Formatting rules are being deprecated
- Still JavaScript-based performance

#### Biome

Rust-based unified linter and formatter, successor to Rome.

Pros:

- Single tool for linting and formatting
- 10-100x faster than ESLint/Prettier
- Minimal configuration required
- Compatible with most ESLint rules
- Active development with regular releases

Cons:

- Smaller plugin ecosystem
- Some ESLint rules not yet implemented
- Newer tool with smaller community

#### deno lint / deno fmt

Deno's built-in tooling.

Pros:

- Fast, Rust-based
- Zero configuration

Cons:

- Designed for Deno, not Node.js
- Limited configurability

## Decision

- Use Biome as the sole linting and formatting tool
- Configure in `biome.json` at repository root
- Run `npm test` for CI linting checks
- Run `npm run fix` for auto-fixing

Configuration:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab"
  },
  "files": {
    "ignore": ["build/", "cdk.out/", "dist/", "node_modules/"]
  }
}
```

## Consequences

- Faster linting (10-100x improvement)
- Simpler configuration (one file vs eslintrc + prettierrc)
- Consistent formatting without Prettier
- Some advanced ESLint plugins not available (compensated by TypeScript strict mode)
- Engineers familiar with ESLint may need minor adjustment
