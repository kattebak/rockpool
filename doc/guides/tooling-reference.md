# Tooling Reference

This guide covers CDK patterns, TypeSpec workflows, code style conventions, and development tooling.

## CDK Infrastructure

### Deployment Architecture

- **Self-Mutating Pipeline**: Root stack deploys a CodePipeline that updates itself
- **Triggers**: Git push to configured branch
- **Multi-Account**: Management account runs pipelines, app accounts host resources

See [ADR-010](../ADR/010-One_infra_pipeline.md) for pipeline architecture details.

### Stack Organization

- **Stacks**: Never reused across stages, have `stageName` parameter
- **Stages**: Organize pipelines
- **Constructs**: Reusable components in `src/constructs/`

### Important CDK Patterns

- **Subpath imports**: Use `#stacks/*`, `#constructs/*`, `#lib/*`, `#config/*` instead of relative imports
- **Naming conventions**: Use consistent naming functions from `src/lib/format.ts`
- **SSM parameters**: Share values between apps/stages (stored in `cdk.context.json`)
- **Config**: Stages defined in `src/config/main.ts`

### CDK Conventions

See `.claude/rules/cdk.md` for comprehensive CDK patterns and best practices.

Key conventions:

- **PascalCase**: Stacks, Stages, Pipelines with app prefix and type suffix
- **Constructs**: PascalCase with type suffix if extending built-in
- **Convention over configuration**: Use naming conventions instead of SSM parameters where possible
- **Parameter passing**:
  - Within stack: Direct object references
  - Between stacks in same app: CFN Outputs (automatic)
  - Between apps/stages: SSM Parameters (manual via cdk.context.json)

Related ADRs:
- [ADR-003](../ADR/003-Implement_infrastructure_as_code_with_AWS_CDK.md) - CDK decision
- [ADR-014](../ADR/014-Convention_over_configuration.md) - Convention over configuration
- [ADR-012](../ADR/012-Cross-account-permissions.md) - Cross-account permissions

## TypeSpec and API Development

### Build Process

```bash
# Compile TypeSpec to OpenAPI
npx tsp compile ./typespec/<api-package>

# Full build (wraps spec in npm package)
make
```

The build process:
1. TypeSpec compiles to OpenAPI 3 JSON (`build/openapi3/openapi.json`)
2. OpenAPI Generator creates TypeScript types
3. Types are packaged as npm workspace package
4. CDK uses OpenAPI spec to create API Gateway SpecRestApi
5. Backend uses openapi-backend for routing and validation

### Using Generated Types

**Always import from the generated package:**

```typescript
import type { Entity, ResultList } from "@org/openapi-package";
```

**NEVER manually define API response types** - they must come from the generated package.

### Backend Lambda Pattern

Single handler routes based on OpenAPI `operationId`:

- Returns mock responses for unimplemented operations
- Validation failures automatically return 400 with AJV errors
- Logger: pino with pino-lambda

Related ADRs:
- [ADR-002](../ADR/002-Model_APIs_using_typespec.md) - TypeSpec for API modeling
- [ADR-007](../ADR/007-API-First_and_OpenAPI-backend.md) - API-first development

## Code Style and Best Practices

### General Conventions

- **No comments**: Keep code self-explanatory
- **No try/catch**: Let errors bubble to Lambda error handler
- **Early returns**: Avoid else statements
- **Kebab-case filenames**: Enforced by Biome
- **Tab indentation**: Configured in biome.json

See [ADR-016](../ADR/016-Biome_for_linting.md) for linting decisions.

### Before Completing Changes

**IMPORTANT**: Always run `npm run fix` before committing or finishing any code changes.

```bash
npm run fix
```

### React Standards (Frontend)

- Use functional components exclusively (never class components)
- Use hooks for state and side effects
- NEVER use `any` type - always use proper TypeScript types
- Prefer custom hooks for reusable logic

See `.claude/rules/typescript.md` for TypeScript standards.

Related ADRs:
- [ADR-006](../ADR/006-Typescript_for_webservices.md) - TypeScript decision

## Testing

- **Infrastructure**: CDK synth validates CloudFormation templates
- **Frontend**: Vitest with jsdom for unit tests
- **Backend**: TypeScript type-checking
- **Linting**: Biome at root level

```bash
# Run all linting
npm test

# Fix auto-fixable issues
npm run fix

# Type-check specific package
npm test -w <package-name>
```

## Deployment

### Infrastructure Changes

1. Push to main branch
2. Self-mutating pipeline runs in management account
3. Deploys all stacks to configured stages

### Application Code

- Push to configured branch triggers CodeBuild
- Frontend: Deploys to S3, invalidates CloudFront
- Backend: Updates Lambda function code

See [ADR-011](../ADR/011-CodeArtifact_deployment.md) for deployment strategy.

## Git and Version Control

### Commit Message Standards

- **Concise and descriptive**: Use imperative mood (e.g., "Add feature" not "Added feature")
- **Multi-line format**: Use title + description for complex changes
- **Scope prefix** (optional): Use prefix for area of change (e.g., "frontend:", "backend:", "infra:")

**Good commit message examples:**

```bash
# Simple change
git commit -m "Add user authentication flow"

# Complex change with description
git commit -m "$(cat <<'EOF'
Add batch processing to data import

Implement chunked uploads with progress tracking and retry logic for failed chunks.
EOF
)"
```

## Related Documentation

- [Architecture Overview](./architecture-overview.md) - System architecture
- [Project Structure](./project-structure.md) - Directory layout and commands
- [Development Workflow](./development-workflow.md) - EDD process and best practices
