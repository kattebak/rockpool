# RFC 002: TypeSpec API-First Development

| Status    | Approved                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author    | Architecture Team                                                                                                                                                                                     |
| Reviewers | Platform Team                                                                                                                                                                                         |
| Created   | 2024                                                                                                                                                                                                  |
| ADRs      | [ADR-002](../ADR/002-Model_APIs_using_typespec.md), [ADR-007](../ADR/007-API-First_and_OpenAPI-backend.md), [ADR-008](../ADR/008-Using_id25_as_identifiers.md), [ADR-009](../ADR/009-Use_DynamoDB.md) |

## Abstract

This RFC defines the patterns, conventions, and best practices for API-first development using TypeSpec. TypeSpec is a service definition language that compiles to OpenAPI 3, JSON Schema, and custom outputs including ElectroDB entities and Zod validation schemas.

## Motivation

API-first development ensures contracts are defined before implementation, enabling:

- Type-safe code generation across frontend and backend
- Automatic request/response validation
- DynamoDB entity generation with ElectroDB
- Consistent API documentation

TypeSpec provides superior developer experience over raw OpenAPI with IDE support, type safety, and extensibility through custom emitters.

## Detailed Design

### Architecture Overview

```mermaid
flowchart TD
    subgraph TypeSpec["TypeSpec Source Files"]
        Lib[lib/<br/>Common Types]
        Models[models/<br/>Entity Definitions]
        API[api/<br/>Endpoints]
        Config[tspconfig.yaml]
    end

    subgraph Compiler["TypeSpec Compiler"]
        TSP[tsp compile]
    end

    subgraph Emitters["Emitters"]
        OpenAPI[@typespec/openapi3]
        JSONSchema[@typespec/json-schema]
        ElectroDB[typespec-electrodb-emitter]
        Zod[typespec-zod-emitter]
        Enums[typespec-enum-emitter]
    end

    subgraph Output["Generated Packages"]
        Spec[OpenAPI Spec<br/>openapi.json]
        Schema[JSON Schema<br/>schema.json]
        Entities[ElectroDB Entities<br/>TypeScript Classes]
        ZodSchemas[Zod Schemas<br/>Validation]
        TSEnums[TypeScript Enums]
    end

    subgraph Consumers["Consumers"]
        CDK[CDK<br/>SpecRestApi]
        Lambda[Lambda Handler<br/>openapi-backend]
        Frontend[Frontend<br/>Type-safe API Client]
    end

    Lib --> TSP
    Models --> TSP
    API --> TSP
    Config --> TSP

    TSP --> OpenAPI
    TSP --> JSONSchema
    TSP --> ElectroDB
    TSP --> Zod
    TSP --> Enums

    OpenAPI --> Spec
    JSONSchema --> Schema
    ElectroDB --> Entities
    Zod --> ZodSchemas
    Enums --> TSEnums

    Spec --> CDK
    Spec --> Lambda
    Entities --> Lambda
    ZodSchemas --> Lambda
    ZodSchemas --> Frontend
    Schema --> Frontend
```

### Directory Structure

```
typespec/
├── lib/                              # Shared utilities and types
│   ├── common.tsp                    # Common scalars, generics
│   ├── string.tsp                    # Custom string scalars with validation
│   ├── util.tsp                      # ResultList<T>, TimestampedEntity
│   ├── cognito-auth.tsp              # Cognito authorization configuration
│   ├── lambda-auth.tsp               # Lambda authorizer configuration
│   ├── extensions/
│   │   └── api-gateway.tsp           # AWS API Gateway CloudFormation integration
│   └── enum/                         # Optional: Separate enum files
│       ├── CountryCode.tsp
│       ├── CurrencyCode.tsp
│       └── ...
├── models/                           # Entity definitions
│   ├── entity-a.tsp
│   ├── entity-b.tsp
│   └── ...
└── api-name/                         # API endpoint definitions
    ├── main.tsp                      # Main API endpoints
    └── tspconfig.yaml                # Emitter configuration
```

### Configuration (tspconfig.yaml)

Standard configuration for full code generation:

```yaml
emit:
  - "@typespec/openapi3" # OpenAPI 3 specification
  - "@typespec/json-schema" # JSON Schema for all models
  - "typespec-electrodb-emitter" # ElectroDB entity classes
  - "@kattebak/typespec-zod-emitter" # Zod validation schemas
  - "@kattebak/typespec-enum-emitter" # TypeScript enums

options:
  "@typespec/openapi3":
    emitter-output-dir: "{cwd}/build/openapi3"
    file-type: "json"

  "@typespec/json-schema":
    emitter-output-dir: "{cwd}/build/openapi3"
    int64-strategy: string
    emitAllModels: true
    emitAllRefs: true
    bundleId: "schema.json"

  "typespec-electrodb-emitter":
    emitter-output-dir: "{cwd}/build/ddb-entities"
    package-name: "@org/ddb-entities"

  "@kattebak/typespec-zod-emitter":
    emitter-output-dir: "{cwd}/build/zod-schemas"
    package-name: "@org/zod-schemas"

  "@kattebak/typespec-enum-emitter":
    emitter-output-dir: "{cwd}/build/ts-enums"
    package-name: "@org/enums"
```

### Core TypeSpec Patterns

#### Custom Scalars with Validation

Define reusable scalar types with built-in validation constraints (ref: [ADR-008](../ADR/008-Using_id25_as_identifiers.md)):

```typescript
// lib/string.tsp
@maxLength(800) scalar String800 extends string;
@maxLength(400) scalar String400 extends string;
@maxLength(200) scalar String200 extends string;
@maxLength(140) scalar String140 extends string;
@maxLength(64)  scalar String64 extends string;
@maxLength(32)  scalar String32 extends string;

@minLength(25)
@maxLength(25)
scalar UUID extends string;

@minLength(3)
@maxLength(48)
scalar DisplayName extends string;

@format("email")
scalar Email extends string;

@format("uri")
scalar URL extends string;
```

#### Generic Models for Pagination

```typescript
// lib/util.tsp
model ResultList<T> {
  @continuationToken
  continuationToken?: String800;
  items: T[];
}

model TimestampedEntity {
  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
```

#### Enums

Inline enums for domain-specific values:

```typescript
// models/trade.tsp
enum TradeStatus {
  Draft,
  Validated,
  Matured,
  Cancelled,
}

enum TradeType {
  Short,
  Long,
}
```

Separate files for large or shared enums:

```typescript
// lib/enum/CountryCode.tsp
enum CountryCode {
  US,
  GB,
  DE,
  FR,
  NL,
  BE,
  // ... 250+ country codes
  NO: "NO",  // Explicit string value when needed
}
```

#### ElectroDB Entity Annotations

(ref: [ADR-009](../ADR/009-Use_DynamoDB.md))

```typescript
// models/batch.tsp
import "@typespec/http";
import "../lib/util.tsp";

using TypeSpec.Http;

@entity("batch", "app")              // entity name, service name
@index(
  "batch",                           // Index name
  { pk: [Batch.batchId], sk: [] }    // Primary key definition
)
@index(
  "byStatus",
  {
    index: "gsi1",                   // GSI name in DynamoDB
    pk: [Batch.status],
    sk: [Batch.createdAt],
  }
)
@index(
  "allByStatus",
  {
    index: "gsi2",
    pk: [],                          // Empty pk = scan index
    sk: [Batch.status],
  }
)
@index(
  "byCounterparty",
  {
    index: "gsi3",
    collection: "counterpartyData",  // Enable ElectroDB collections
    pk: [Batch.counterpartyId],
    sk: [Batch.createdAt],
  }
)
model Batch {
  @visibility(Lifecycle.Read)
  @key
  batchId: UUID;

  status?: BatchStatus = BatchStatus.Created;

  @visibility(Lifecycle.Read, Lifecycle.Create)
  name: DisplayName;

  counterpartyId?: UUID;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

enum BatchStatus {
  Created,
  PendingReview,
  Reviewed,
  Rejected,
}
```

#### Model Inheritance for Operations

```typescript
// Base model with all fields
model Trade extends TimestampedEntity {
  @visibility(Lifecycle.Read)
  @key
  tradeId: UUID;

  @visibility(Lifecycle.Read, Lifecycle.Create)
  tradeType: TradeType;

  status?: TradeStatus = TradeStatus.Draft;
  counterpartyId: UUID;
  volume?: float64;
  price?: float64;
}

// Create parameters - subset of fields
model TradeCreateParams is Create<Trade>;

// Update parameters - subset of fields
model TradeUpdateParams is Update<Trade>;

// Extended model with computed fields for reads
model TradeWithDetails extends Trade {
  counterpartyName?: String200;
  totalValue?: float64;
  legs?: TradeLeg[];
}
```

### API Endpoint Definitions

#### Standard API Structure

(ref: [ADR-007](../ADR/007-API-First_and_OpenAPI-backend.md))

```typescript
// api/main.tsp
import "@typespec/rest";
import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";
import "@typespec/versioning";

import "../lib/extensions/api-gateway.tsp";
import "../lib/cognito-auth.tsp";
import "../models/trade.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@useAuth(CognitoAuthorizer)
@service(#{ title: "My Application API" })
@server("https://api.example.com/", "Production server")
namespace MyAppAPI;

@route("/trades")
namespace TradeOperations {
  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @get
  op listTrades(
    @query(#{ explode: true })
    @continuationToken
    continuationToken?: string,

    @query(#{ explode: true })
    count?: int32,

    @query(#{ explode: true })
    status?: TradeStatus,
  ): ResultList<Trade>;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @post
  op createTrade(@body trade: TradeCreateParams): Trade;
}

@route("/trade/{tradeId}")
namespace TradeDetailOperations {
  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @get
  op describeTrade(@path tradeId: UUID): TradeWithDetails;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @put
  op updateTrade(
    @path tradeId: UUID,
    @body trade: TradeUpdateParams,
  ): Trade;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @delete
  op deleteTrade(@path tradeId: UUID): void;
}

@route("/trade/{tradeId}/legs")
namespace TradeLegOperations {
  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @get
  op listTradeLegs(@path tradeId: UUID): ResultList<TradeLeg>;

  @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
  @post
  op createTradeLeg(
    @path tradeId: UUID,
    @body leg: TradeLegCreateParams,
  ): TradeLeg;
}
```

#### AWS API Gateway Integration Extension

```typescript
// lib/extensions/api-gateway.tsp
const APIGatewayIntegration = #{
  type: "aws_proxy",
  httpMethod: "POST",
  passthroughBehavior: "when_no_match",
  uri: #{
    `Fn::Sub`: "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:{{HandlerFunctionName}}/invocations",
  },
};
```

Template variables like `{{HandlerFunctionName}}` are replaced at CDK deployment time.

#### Authentication Extensions

Cognito User Pool authorization:

```typescript
// lib/cognito-auth.tsp
@extension("x-amazon-apigateway-authtype", "cognito_user_pools")
@extension(
  "x-amazon-apigateway-authorizer",
  #{ type: "cognito_user_pools", providerARNs: #["{{CognitoUserPoolArn}}"] }
)
model CognitoAuthorizer is ApiKeyAuth<ApiKeyLocation.header, "Authorization">;
```

AWS SigV4 authorization (for service-to-service):

```typescript
// lib/sigv4-authorizer.tsp
@extension("x-amazon-apigateway-authtype", "awsSigv4")
model Sigv4Authorizer is ApiKeyAuth<ApiKeyLocation.header, "Authorization">;
```

### Visibility Control

Control field visibility across different operations:

| Visibility                         | Create | Read | Update |
| ---------------------------------- | ------ | ---- | ------ |
| `Lifecycle.Read`                   | No     | Yes  | No     |
| `Lifecycle.Create`                 | Yes    | Yes  | No     |
| `Lifecycle.Update`                 | No     | Yes  | Yes    |
| `Lifecycle.Read, Lifecycle.Create` | Yes    | Yes  | No     |
| `Lifecycle.Read, Lifecycle.Update` | No     | Yes  | Yes    |
| Default (no decorator)             | Yes    | Yes  | Yes    |

```typescript
model Entity {
  @visibility(Lifecycle.Read)           // Server-generated, read-only
  @key
  entityId: UUID;

  @visibility(Lifecycle.Read, Lifecycle.Create)  // Set on create, read-only after
  name: DisplayName;

  @visibility(Lifecycle.Read, Lifecycle.Update)  // Read and update, not on create
  status: EntityStatus;

  description?: String400;              // Full access - create, read, update
}
```

### Key Decorators Reference

| Decorator                 | Purpose                         | Example                                                       |
| ------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `@entity(name, service)`  | Marks model as ElectroDB entity | `@entity("batch", "app")`                                     |
| `@index(name, config)`    | Defines DynamoDB index          | `@index("byStatus", { index: "gsi1", pk: [...], sk: [...] })` |
| `@key`                    | Marks field as ElectroDB key    | `@key batchId: UUID`                                          |
| `@visibility(...)`        | Controls field visibility       | `@visibility(Lifecycle.Read)`                                 |
| `@createdAt`              | Auto-timestamp creation         | `@createdAt createdAt: int64`                                 |
| `@updatedAt`              | Auto-timestamp updates          | `@updatedAt updatedAt: int64`                                 |
| `@continuationToken`      | Marks pagination cursor         | `@continuationToken token?: string`                           |
| `@route(path)`            | HTTP route path                 | `@route("/items")`                                            |
| `@extension(name, value)` | OpenAPI extension               | `@extension("x-amazon-apigateway-integration", ...)`          |
| `@useAuth(model)`         | Sets authorization              | `@useAuth(CognitoAuthorizer)`                                 |
| `@doc(text)`              | Documentation string            | `@doc("The unique identifier")`                               |
| `@maxLength(n)`           | Max string length               | `@maxLength(200)`                                             |
| `@minLength(n)`           | Min string length               | `@minLength(1)`                                               |
| `@pattern(regex)`         | Regex validation                | `@pattern("^[A-Z]{2}$")`                                      |
| `@format(format)`         | String format                   | `@format("email")`                                            |

### ElectroDB Index Patterns

#### Primary Index (Table Key)

```typescript
@index(
  "primary",
  { pk: [Entity.entityId], sk: [] }
)
```

#### Composite Sort Key

```typescript
@index(
  "byStatusAndDate",
  {
    index: "gsi1",
    pk: [Entity.status],
    sk: [Entity.createdAt],
  }
)
```

#### Scan Index (No Partition Key)

```typescript
@index(
  "allByName",
  {
    index: "gsi2",
    pk: [],
    sk: [Entity.name],
  }
)
```

#### Collections (Cross-Entity Queries)

```typescript
@index(
  "byParent",
  {
    index: "gsi3",
    collection: "parentData",
    pk: [Entity.parentId],
    sk: [Entity.createdAt],
  }
)
```

#### Scoped Index (Entity Isolation)

```typescript
@index(
  "byName",
  {
    index: "gsi1",
    scope: "entity",
    pk: [],
    sk: [Entity.name],
  }
)
```

### Generated Package Usage

#### Backend Lambda

```typescript
// Import types from generated package
import type { Trade, TradeCreateParams, ResultList } from "@org/openapi3";

// Import ElectroDB entities
import { TradeEntity } from "@org/ddb-entities";

// Import Zod schemas for validation
import { TradeCreateParamsSchema } from "@org/zod-schemas";

// Handler implementation
export const createTrade: Handler = async (c, event, context) => {
  const body = TradeCreateParamsSchema.parse(c.request.requestBody);
  const trade = await TradeEntity.create(body).go();
  return {
    statusCode: 201,
    body: JSON.stringify(trade.data),
  };
};
```

#### Frontend

```typescript
// Import types for API responses
import type { Trade, ResultList } from "@org/types";

// Type-safe API client
async function fetchTrades(): Promise<ResultList<Trade>> {
  const response = await fetch("/api/trades");
  return response.json();
}
```

#### CDK Infrastructure

```typescript
// Import OpenAPI spec
import spec from "@org/openapi3";

// Create API Gateway from spec
const api = new APIGatewayOpenAPI(this, "API", {
  name: "my-app-api",
  handler: lambdaFunction,
  spec: JSON.stringify(spec.OpenAPISpec),
  allowedOrigins: ["https://app.example.com"],
  templateVariables: {
    HandlerFunctionName: lambdaFunction.functionName,
    CognitoUserPoolArn: userPool.userPoolArn,
  },
});
```

### Build Integration

#### Makefile

```makefile
.PHONY: all clean

# Main target
all: build/openapi3/package.json build/ddb-entities/package.json

# Compile TypeSpec to OpenAPI
build/openapi3/openapi.json: typespec/**/*.tsp typespec/api/tspconfig.yaml
	npx tsp compile ./typespec/api

# Generate npm package from OpenAPI spec
build/openapi3/package.json: build/openapi3/openapi.json
	./scripts/generate-spec-package.sh $< $(dir $@)

# ElectroDB entities are generated by tsp compile
build/ddb-entities/package.json: build/openapi3/openapi.json
	cd build/ddb-entities && npm pack

clean:
	rm -rf build/
```

#### Package Dependencies

```json
{
  "devDependencies": {
    "@typespec/compiler": "^1.4.0",
    "@typespec/http": "^1.4.0",
    "@typespec/json-schema": "^1.4.0",
    "@typespec/openapi": "^1.4.0",
    "@typespec/openapi3": "^1.4.0",
    "@typespec/rest": "^0.75.0",
    "@typespec/versioning": "^0.77.0",
    "@kattebak/typespec-zod-emitter": "^1.2.2",
    "@kattebak/typespec-enum-emitter": "^1.2.2",
    "typespec-electrodb-emitter": "^3.2.1"
  }
}
```

## Implementation Phases

### Phase 1: Foundation

1. Create `typespec/` directory structure
2. Define common scalars in `lib/string.tsp` or `lib/common.tsp`
3. Create `lib/util.tsp` with `ResultList<T>` and `TimestampedEntity`
4. Create `lib/extensions/api-gateway.tsp` with AWS integration

### Phase 2: Models

1. Define entity models in `models/` directory
2. Add ElectroDB annotations (`@entity`, `@index`)
3. Define enums for domain values
4. Create parameter models (Create/Update variants)

### Phase 3: API

1. Create API folder with `main.tsp` and `tspconfig.yaml`
2. Import all models and utilities
3. Define routes and operations
4. Apply API Gateway integration to all operations

### Phase 4: Build Pipeline

1. Configure `tspconfig.yaml` with required emitters
2. Add Makefile targets for TypeSpec compilation
3. Create package generation scripts
4. Integrate with npm workspace

### Phase 5: Integration

1. Import types in frontend and backend packages
2. Use ElectroDB entities in Lambda handlers
3. Deploy SpecRestApi with CDK
4. Validate end-to-end type safety

## Best Practices

1. **Separation of Concerns**: Keep lib for shared types, models for entities, separate folders for each API

2. **DRY Principle**: Use generic models like `ResultList<T>` and `TimestampedEntity`

3. **Consistent Naming**: Use PascalCase for models and enums, camelCase for fields

4. **Validation at Source**: Define constraints on scalars (`@maxLength`, `@minLength`, `@pattern`)

5. **Visibility Control**: Use `@visibility` to control field access across operations

6. **Index Design**: Plan DynamoDB indexes upfront with access patterns in mind

7. **Collections**: Use ElectroDB collections for cross-entity queries

8. **Template Variables**: Use `{{Variable}}` syntax for CDK deployment-time injection

9. **Enum Organization**: Keep small enums inline, separate large or shared enums

10. **API Gateway Integration**: Apply `@extension("x-amazon-apigateway-integration", ...)` to all operations

## Alternatives Considered

### Raw OpenAPI vs TypeSpec

Raw OpenAPI YAML is verbose and error-prone. TypeSpec provides better IDE support, type inference, and code reuse through generics and model inheritance.

### GraphQL vs REST

GraphQL adds complexity for simple CRUD applications. REST with OpenAPI provides sufficient flexibility while maintaining simplicity and broad tooling support.

### Prisma vs ElectroDB

Prisma requires a separate migration system and doesn't integrate well with DynamoDB single-table design. ElectroDB generates entities directly from TypeSpec models.

## References

- [ADR-002: Model APIs using TypeSpec](../ADR/002-Model_APIs_using_typespec.md)
- [ADR-007: API-First and OpenAPI-backend](../ADR/007-API-First_and_OpenAPI-backend.md)
- [ADR-008: Using id25 as identifiers](../ADR/008-Using_id25_as_identifiers.md)
- [ADR-009: Use DynamoDB](../ADR/009-Use_DynamoDB.md)
- [RFC-001: Serverless Foundation Template](./001_Serverless_Foundation_Template.md)
