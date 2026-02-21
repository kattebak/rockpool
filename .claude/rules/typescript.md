# TypeScript Standards

## Documentation Lookup

Use the **context7** MCP server to look up current documentation for any library before implementing. This ensures you're using up-to-date APIs and patterns.

## Type Safety

### Never use `any`

Use `unknown` when the type is truly unknown, then validate:

```typescript
// Good
function handleApiResponse(data: unknown): Extraction {
  if (!isExtraction(data)) {
    throw new Error('Invalid extraction data')
  }
  return data
}

// Bad
function handleApiResponse(data: any): Extraction {
  return data as Extraction
}
```

### Always use explicit types

Define types for function parameters, return values, and state:

```typescript
// Good
function processData(items: DataItem[]): ProcessedResult {
  return items.map(item => transform(item))
}

// Bad
function processData(items) {
  return items.map(item => transform(item))
}
```

### Use type guards over casting

Create type guards to validate unknown data at runtime:

```typescript
function isExtraction(value: unknown): value is Extraction {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const obj = value as Record<string, unknown>
  return (
    (typeof obj.counterparty === 'string' || obj.counterparty === null) &&
    (typeof obj.volume === 'number' || obj.volume === null)
  )
}
```

### Use zod for complex validation

```typescript
import { z } from 'zod'

const ExtractionSchema = z.object({
  counterparty: z.string().nullable(),
  volume: z.number().nullable(),
  unit: z.enum(['kWh', 'MWh', 'kWh cumac', 'MWh cumac']).nullable(),
})

type Extraction = z.infer<typeof ExtractionSchema>

function parseExtraction(data: unknown): Extraction {
  return ExtractionSchema.parse(data)
}
```

## Error Handling

### Fail fast

Don't catch, log, and rethrow. Let errors bubble up:

```typescript
// Good - let it crash
function processDocument(doc: Document): Result {
  const parsed = parse(doc)
  return transform(parsed)
}

// Bad - catch/log/rethrow
function processDocument(doc: Document): Result {
  try {
    const parsed = parse(doc)
    return transform(parsed)
  } catch (error) {
    console.error('Failed to process:', error)
    throw error
  }
}
```

### Crash unless recoverable

Most errors are not recoverable: programmer errors, dependency failures, downstream service errors. Only catch errors when you have a specific recovery strategy:

```typescript
// Good - only catch when recoverable
function getFromCache(key: string): Data | null {
  return cache.get(key)  // returns null on miss, no try-catch needed
}

// Bad - catching unrecoverable errors
function getData(id: string): Data {
  try {
    return database.query(id)
  } catch (error) {
    return defaultData  // hiding real problems
  }
}
```

### No try-catch in async code

Use promise chaining instead of try-catch:

```typescript
// Good - promise chaining
function fetchData(id: string): Promise<Data> {
  return loadDataFromSource(id)
    .then(data => validateData(data))
}

// Good - let async errors propagate
async function fetchData(id: string): Promise<Data> {
  const data: unknown = await loadDataFromSource(id)
  return validateData(data)
}

// Bad - try-catch in async
async function fetchData(id: string): Promise<Data> {
  try {
    const data = await loadDataFromSource(id)
    return data
  } catch (error) {
    console.error(error)
    throw error
  }
}
```

## Code Style

### No comments

Write self-explanatory code. Use descriptive names instead of comments.

Only comment:
- Complex business logic that isn't obvious
- Non-standard workarounds or edge cases

### Return early

Avoid else statements. Write small functions that return early:

```typescript
// Good - return early
function getDiscount(user: User): number {
  if (!user.isActive) {
    return 0
  }

  if (user.isPremium) {
    return 0.2
  }

  if (user.ordersCount > 10) {
    return 0.1
  }

  return 0.05
}

// Bad - nested else
function getDiscount(user: User): number {
  if (user.isActive) {
    if (user.isPremium) {
      return 0.2
    } else {
      if (user.ordersCount > 10) {
        return 0.1
      } else {
        return 0.05
      }
    }
  } else {
    return 0
  }
}
```
