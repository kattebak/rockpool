# @bookstore/ddb-service

A reference implementation demonstrating the DynamoDB service layer pattern using ElectroDB. This package serves as a **template and starting point** for building type-safe database operations in serverless applications.

## Purpose

This package demonstrates:

- **Spec-first architecture**: Types flow from TypeSpec → OpenAPI → TypeScript
- **ElectroDB integration**: Type-safe DynamoDB operations with automatic index management
- **Service layer pattern**: Clean separation between API handlers and database operations
- **Pagination with token validation**: Secure cursor-based pagination using HMAC-verified tokens
- **Consistent error handling**: HTTP-compatible error classes for Lambda integration

## Quick Start

```typescript
import { createClient } from "@bookstore/ddb-service";

// Initialize the client
const db = createClient({
  tableName: process.env.DYNAMODB_TABLE_NAME,
  salt: process.env.TOKEN_SALT,
  // For local development:
  nodeEnv: "development",
  port: "5125",
});

// Create an author
const author = await db.author.create("aut_abc123xyz", {
  name: "Jane Doe",
  biography: "Award-winning novelist",
  email: "jane@example.com",
});

// Create a book
const book = await db.book.create("bok_def456uvw", {
  authorId: author.authorId,
  title: "The Great Adventure",
  genre: "Fiction",
});

// Publish the book
await db.book.publish(book.bookId);

// List with pagination
const { items, continuationToken } = await db.author.list({ count: 20 });
```

## Architecture

### Type Flow

```
TypeSpec definitions
       ↓
  OpenAPI 3.0 spec
       ↓
┌──────┴──────┐
↓             ↓
ElectroDB     TypeScript
entities      types
       ↓             ↓
       └──────┬──────┘
              ↓
      DDB Service Layer
```

All types originate from TypeSpec and flow through the build system. **Never manually define API types** - always import from generated packages.

### Package Dependencies

```
@bookstore/ddb-service
├── @bookstore/ddb-entities    # ElectroDB entity schemas (generated)
├── @bookstore/bookstore-types # TypeScript types (generated)
└── electrodb                  # DynamoDB ODM
```

## Core Patterns

### 1. Client Factory

The `createClient` function returns a lazy-initialized client with getters for each entity:

```typescript
const db = createClient(config);

// Each access creates a fresh operations instance
// sharing the same underlying DynamoDB client
const author1 = await db.author.get(id);
const author2 = await db.author.get(id);
```

### 2. Operations Classes

Each entity has an Operations class extending `BaseModel`:

```typescript
export class AuthorOperations extends BaseModel {
  // ElectroDB entity getter
  get author() {
    return this.getEntity(AuthorSchema);
  }

  // CRUD operations returning typed responses
  async get(authorId: string): Promise<Author> {
    const { data } = await this.author.get({ authorId }).go();
    if (!data) return Promise.reject(new NotFoundError());
    return data as Author;
  }
}
```

### 3. Pagination with Token Security

Continuation tokens include HMAC-MD5 verification to prevent tampering:

```typescript
// Creating tokens (internal)
const token = this.createContinuationToken(cursor);

// Extracting and validating tokens
const cursor = this.extractContinuationToken(userProvidedToken);
// Throws ClientError if token is invalid or tampered
```

### 4. Error Handling

HTTP-compatible error classes for seamless Lambda integration:

```typescript
import { NotFoundError, BadRequestError, ConflictError } from "@bookstore/ddb-service";

// In your Lambda handler:
try {
  return await db.author.get(authorId);
} catch (err) {
  if (err instanceof HTTPError) {
    return { statusCode: err.statusCode, body: err.message };
  }
  throw err;
}
```

| Error Class | Status Code | Use Case |
|-------------|-------------|----------|
| `BadRequestError` | 400 | Validation failures |
| `ClientError` | 401 | Invalid tokens |
| `NotFoundError` | 404 | Resource not found |
| `ConflictError` | 409 | Duplicate key |
| `InternalServerError` | 500 | Unexpected errors |

### 5. ElectroDB Services for Joins

Use ElectroDB Services for multi-entity queries:

```typescript
get bookService() {
  return new Service({
    books: this.book,
    authors: this.author,
  });
}

async describe(bookId: string): Promise<DescribeBookResponse> {
  const { data: { books } } = await this.bookService.collections
    .book({ bookId })
    .go({ pages: "all" });
  // ...
}
```

## API Reference

### AuthorOperations

| Method | Description |
|--------|-------------|
| `get(authorId)` | Get author by ID |
| `list({ count?, continuationToken? })` | List authors with pagination |
| `describe(authorId)` | Get author with book count |
| `listBooks(authorId, { count?, continuationToken? })` | List author's books |
| `create(authorId, data)` | Create new author |
| `update(authorId, data)` | Update author fields |
| `delete(authorId)` | Delete author |

### BookOperations

| Method | Description |
|--------|-------------|
| `get(bookId)` | Get book by ID |
| `list({ count?, continuationToken?, status?, genre? })` | List books with filters |
| `describe(bookId)` | Get book with author details |
| `create(bookId, data)` | Create new book |
| `update(bookId, data)` | Update book fields |
| `delete(bookId)` | Delete book |
| `publish(bookId)` | Set status to Published |
| `unpublish(bookId)` | Set status to Draft |

## Local Development

### Prerequisites

- Node.js 22+
- Java (for DynamoDB Local)

### Running Tests

```bash
# Start DynamoDB Local and run tests
npm test -w @bookstore/ddb-service

# Watch mode
npm run watch:test -w @bookstore/ddb-service

# Type-check only
npm run test:typecheck -w @bookstore/ddb-service
```

### Environment Variables

Create `.env.test`:

```
DYNAMODB_PORT=5125
DYNAMODB_TABLE_NAME=bookstore-local
```

## Extending This Template

### Adding a New Entity

1. **Define in TypeSpec** (`typespec/models/new-entity.tsp`)
2. **Regenerate types**: `make`
3. **Create operations class**:

```typescript
// src/models/new-entity.ts
import { NewEntity as NewEntitySchema } from "@bookstore/ddb-entities";
import type { Components } from "@bookstore/bookstore-types";

type NewEntity = Components.Schemas.NewEntity;

export class NewEntityOperations extends BaseModel {
  get entity() {
    return this.getEntity(NewEntitySchema);
  }

  async get(id: string): Promise<NewEntity> {
    const { data } = await this.entity.get({ id }).go();
    if (!data) return Promise.reject(new NotFoundError());
    return data as NewEntity;
  }

  // ... additional operations
}
```

4. **Register in client factory** (`src/index.ts`):

```typescript
export const createClient = (config: DBConfig) => {
  // ...
  return {
    // ...existing entities
    get newEntity() {
      return new NewEntityOperations(client, tableName, salt);
    },
  };
};
```

5. **Update table schema** if new indexes are needed (`dynamodb/table.schema.json`)

### Best Practices

- **Always use generated types** - never manually define API response types
- **Let errors bubble** - don't catch/log/rethrow; use the error classes
- **Use Services for joins** - ElectroDB Services handle multi-entity queries efficiently
- **Validate at boundaries** - check constraints in the operations layer, not in handlers

## File Structure

```
packages/bookstore-ddb-service/
├── src/
│   ├── index.ts              # Client factory and exports
│   └── models/
│       ├── base.ts           # BaseModel, errors, pagination
│       ├── author.ts         # AuthorOperations
│       ├── book.ts           # BookOperations
│       ├── test-fixtures.ts  # Test utilities
│       ├── author.test.ts    # Author tests
│       └── book.test.ts      # Book tests
├── package.json
├── tsconfig.json
└── .env.test
```

## Related Packages

- `@bookstore/ddb-entities` - Generated ElectroDB schemas
- `@bookstore/bookstore-types` - Generated TypeScript types
- `@bookstore/zod-schemas` - Generated Zod validation schemas
