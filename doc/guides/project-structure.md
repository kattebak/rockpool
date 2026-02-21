# Project Structure

This guide describes the project directory organization and common development commands.

## Directory Layout

```
project-root/
├── src/                           # CDK infrastructure code
│   ├── app/                       # CDK app entry points
│   ├── config/                    # Configuration
│   ├── lib/                       # Utility functions
│   ├── constructs/                # Reusable CDK constructs
│   └── stacks/                    # CDK stacks
├── packages/                      # npm workspace packages
│   ├── <frontend-package>/        # React frontend
│   │   └── src/
│   │       ├── components/        # React components
│   │       ├── pages/             # Route pages
│   │       ├── stores/            # State management
│   │       ├── hooks/             # Custom hooks
│   │       ├── api/               # API client code
│   │       └── router/            # React Router
│   └── <backend-package>/         # Lambda backend
│       └── src/
│           ├── index.ts           # Lambda handler entry
│           └── ...
├── typespec/                      # TypeSpec API definitions
│   ├── lib/                       # Shared types and utilities
│   └── models/                    # Entity definitions
├── build/                         # Generated files (gitignored)
├── doc/                           # Documentation
│   ├── guides/                    # Development guides
│   ├── ADR/                       # Architecture Decision Records
│   ├── EDD/                       # Entity Design Documents
│   └── RFC/                       # Request for Comments
├── .claude/                       # Claude Code configuration
│   ├── agents/                    # Specialized sub-agents
│   ├── rules/                     # Coding standards
│   ├── templates/                 # Document templates
│   └── settings.json              # Claude permissions
├── Makefile                       # Build orchestration
└── package.json                   # Root workspace config
```

## Common Development Commands

### Root Commands

```bash
# Install all dependencies
npm install

# Lint entire codebase with Biome
npm test

# Auto-fix Biome issues
npm run fix

# Generate OpenAPI spec from TypeSpec
make

# Synthesize CloudFormation templates
npm run cdk:synth
```

### Frontend Development

```bash
# Development server with hot-reload
npm run dev -w <frontend-package>

# Type-check TypeScript
npm run type-check -w <frontend-package>

# Production build
npm run build -w <frontend-package>

# Run unit tests with Vitest
npm run test:unit -w <frontend-package>
```

### Backend Development

```bash
# Type-check TypeScript
npm test -w <backend-package>

# Bundle Lambda code with esbuild
npm run bundle -w <backend-package>

# Start local dev server
npm run dev -w <backend-package>
```

### Infrastructure (CDK)

```bash
# List all stacks
npx cdk list

# Synthesize specific stack
npx cdk synth <stack-name>

# Deploy to AWS (typically done via pipeline)
npx cdk deploy <stack-name>

# Show diff between deployed and local
npx cdk diff <stack-name>
```

### TypeSpec and API

```bash
# Compile TypeSpec to OpenAPI
npx tsp compile ./typespec/<api-package>

# Full build (wraps spec in npm package)
make

# Validate TypeSpec models
npx tsp format --check ./typespec/<api-package>
```

## Node.js Requirements

- **Version**: Node.js 22 (use nvm: `nvm install 22`)
- **Java**: Required for OpenAPI Generator and DynamoDB Local

## npm Workspace Structure

This project uses npm workspaces as a monorepo. See [ADR-015](../ADR/015-npm_workspaces_monorepo.md) for the decision rationale.

Key benefits:
- Shared dependencies managed at root
- Local package linking without publishing
- Unified build and test commands
- Generated types easily shared between packages

## Related Documentation

- [Architecture Overview](./architecture-overview.md) - System architecture and components
- [Tooling Reference](./tooling-reference.md) - Detailed tooling workflows
- [ADR-014](../ADR/014-Convention_over_configuration.md) - Convention over configuration
