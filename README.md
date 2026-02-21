# Serverless Foundation

A reference implementation for serverless, API-first development on AWS using CDK, TypeSpec, and modern TypeScript patterns.

## Documentation

This template is built on a foundation of architectural decisions and design documents. **Read these first** to understand the patterns and conventions used throughout the codebase.

| Type    | Description                               | Location                   |
| ------- | ----------------------------------------- | -------------------------- |
| **RFC** | High-level proposals and rationale        | [doc/RFC/](./doc/RFC/)   |
| **ADR** | Architecture Decision Records             | [doc/ADR/](./doc/ADR/)   |
| **EDD** | Entity Design Documents (technical specs) | [doc/EDD/](./doc/EDD/)   |
| **Guide** | Development guides and references       | [doc/guides/](./doc/guides/) |

### Key Documents

- [RFC 001: Serverless Foundation Template](./doc/RFC/001_Serverless_Foundation_Template.md) - Why this template exists
- [RFC 002: TypeSpec API-First Development](./doc/RFC/002_TypeSpec_API_First_Development.md) - API design approach
- [EDD 001: Reference CDK Infrastructure](./doc/EDD/001_Reference_CDK_Infrastructure.md) - Infrastructure implementation spec
- [ADR 007: API-First and OpenAPI-backend](./doc/ADR/007-API-First_and_OpenAPI-backend.md) - Backend routing pattern
- [ADR 009: Use DynamoDB](./doc/ADR/009-Use_DynamoDB.md) - Database choice and patterns

## Architecture

This repository demonstrates a complete serverless _reference_ stack:

- **API Gateway** - OpenAPI-driven REST API with Cognito authentication
- **Lambda** - ARM64 Node.js handlers with openapi-backend routing
- **DynamoDB** - Single-table design with ElectroDB entities
- **Cognito** - User authentication with hosted UI
- **CloudFront + S3** - Static frontend hosting

## Prerequisites

- Node.js 22+: [nvm](https://github.com/nvm-sh/nvm), then `nvm install 22`
- Java (for DynamoDB Local and OpenAPI Generator): [sdkman](https://sdkman.io/), then `sdk install java`
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- Access to the [AWS account](https://stxgroup.atlassian.net/wiki/spaces/PE/pages/66027552/AWS+Accounts) **STX Commodities B.V. Playground**

## AWS SSO Setup

### 1. Configure AWS SSO

> More info: [AWS CLI with SSO - Platform Engineering - Confluence](https://stxgroup.atlassian.net/wiki/spaces/PE/pages/1577058310/AWS+CLI+with+SSO)

```bash
aws configure sso
```

When prompted:

- **SSO session name**: `stx`
- **SSO start URL**: `https://stx-sso.awsapps.com/start`
- **SSO region**: `eu-central-1`
- **SSO registration scopes**: `sso:account:access`
- **Account**: `STX Commodities B.V. Playground`
- **CLI default client Region**: `eu-central-1`
- **Profile name**: `STX-Sandbox-DeveloperAccess`

### 2. Set Your Profile

Export the profile for CDK to use:

```bash
export AWS_PROFILE=STX-Sandbox-DeveloperAccess
```

Or pass it directly to CDK commands:

```bash
npm run cdk:synth -- --profile STX-Sandbox-DeveloperAccess
```

### 3. Verify Credentials

```bash
aws sts get-caller-identity
```

### Refreshing credentials (every 8 hours)

Later on, when the credential expire:

```bash
aws sso login
```

## Quick Start

### Install Dependencies

```bash
npm install
```

### Build TypeSpec (generates OpenAPI spec)

```bash
make
```

### Synthesize CloudFormation

```bash
npm run cdk:synth
```

### Deploy to AWS

```bash
npm run cdk:deploy
```

## Resource Naming

All AWS resources are prefixed with your username to avoid conflicts in shared accounts. By default, the username is detected from your system.

**Examples with username `jdoe`:**

- Stack: `jdoe-BookstoreStack`
- DynamoDB Table: `jdoe-bookstore`
- Lambda Function: `jdoe-bookstore-backend`
- Cognito User Pool: `jdoe-bookstore-users`
- S3 Bucket: `jdoe-bookstore-frontend`

### Override Username

```bash
npm run cdk:deploy -- -c username=myprefix
```

## CDK Context Flags

| Flag             | Default                          | Description                                   |
| ---------------- | -------------------------------- | --------------------------------------------- |
| `username`       | Current OS user                  | Prefix for all resource names                 |
| `account`        | `CDK_DEFAULT_ACCOUNT`            | AWS account ID                                |
| `region`         | `eu-central-1`                   | AWS region                                    |
| `callbackUrls`   | `http://localhost:3000/callback` | Cognito OAuth callback URLs (comma-separated) |
| `logoutUrls`     | `http://localhost:3000/logout`   | Cognito logout URLs (comma-separated)         |
| `allowedOrigins` | `http://localhost:3000`          | CORS allowed origins (comma-separated)        |

### Example: Full Deployment

```bash
npm run cdk:deploy -- \
  -c username=jdoe \
  -c account=123456789012 \
  -c region=eu-central-1 \
  -c allowedOrigins=https://myapp.example.com,http://localhost:3000
```

## Project Structure

```
.
├── src/                          # CDK infrastructure code
│   ├── app/
│   │   └── bookstore.ts          # CDK app entry point
│   ├── config/
│   │   └── main.ts               # Configuration
│   ├── lib/
│   │   ├── format.ts             # Resource naming conventions
│   │   └── inject-cors-options.ts
│   ├── constructs/               # Reusable CDK constructs
│   │   ├── apigateway/
│   │   ├── cognito/
│   │   ├── dynamodb/
│   │   └── lambda/
│   └── stacks/
│       └── bookstore/
│           └── bookstore-stack.ts
├── packages/                     # Application code
│   ├── bookstore-backend/        # Lambda handler
│   └── bookstore-ddb-service/    # ElectroDB entities
├── typespec/                     # API specifications
│   └── bookstore-api/
├── build/                        # Generated files
│   ├── bookstore-openapi3/       # OpenAPI spec
│   └── bookstore-types/          # TypeScript types
├── doc/                          # Documentation
│   ├── guides/                   # Development guides
│   ├── ADR/                      # Architecture Decision Records
│   ├── EDD/                      # Entity Design Documents
│   └── RFC/                      # Request for Comments
├── cdk.json                      # CDK configuration
├── Makefile                      # Build orchestration
└── package.json
```

## Development Commands

### Root Level

```bash
# Install all dependencies
npm install

# Build TypeSpec to OpenAPI
make

# Synthesize CDK (CloudFormation templates)
npm run cdk:synth

# Preview changes before deploy
npm run cdk:diff

# Deploy to AWS
npm run cdk:deploy

# Destroy stack
npm run cdk:destroy

# List stacks
npm run cdk:list

# Pass additional flags with --
npm run cdk:deploy -- -c username=myprefix --profile MyProfile
```

### Backend Package

```bash
# Type-check
npm test -w bookstore-backend

# Bundle Lambda
npm run bundle -w bookstore-backend
```

### DynamoDB Service

```bash
# Run tests (requires DynamoDB Local)
npm test -w bookstore-ddb-service
```

## TypeSpec API Development

API endpoints are defined in TypeSpec and compiled to OpenAPI:

```bash
# Edit API definitions
# typespec/bookstore-api/

# Regenerate OpenAPI spec
make

# Types are automatically generated to:
# build/bookstore-types/
```

Import generated types in your code:

```typescript
import type { Author, Book } from "@bookstore/types";
```

## Cleaning Up

To avoid ongoing AWS charges, destroy your stack when done:

```bash
npm run cdk:destroy
```

Or destroy with a specific username:

```bash
npm run cdk:destroy -- -c username=jdoe
```

## STX Sandbox Guidelines

The STX Sandbox account is a shared playground environment:

1. **Always use your username prefix** - Resources without prefixes may be deleted
2. **Clean up when done** - Run `npm run cdk:destroy` to remove your resources
3. **Don't modify others' resources** - Only manage stacks with your username prefix
4. **Cost awareness** - Monitor your resource usage; DynamoDB on-demand and Lambda are cost-effective but CloudFront distributions have ongoing costs

## Troubleshooting

### SSO Session Expired

```bash
aws sso login --sso-session stx
```

### CDK Bootstrap Required

If deploying to a new account/region:

```bash
npm run cdk:bootstrap -- aws://ACCOUNT_ID/REGION
```

### Permission Errors

Ensure you're using the correct profile:

```bash
export AWS_PROFILE=STX-Sandbox-DeveloperAccess
aws sts get-caller-identity
```

## Further Reading

- [CLAUDE.md](./CLAUDE.md) - AI assistant guidelines and project conventions
- [doc/guides/](./doc/guides/) - Development guides (workflow, architecture, tooling)
- [doc/EDD/](./doc/EDD/) - Entity Design Documents
- [doc/ADR/](./doc/ADR/) - Architecture Decision Records
- [doc/RFC/](./doc/RFC/) - Request for Comments
