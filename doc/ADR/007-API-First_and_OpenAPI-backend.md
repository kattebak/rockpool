# API First and OpenAPI backend

## Status

_accepted_

## Context

Using [OpenAPI specifications](./002-Model_APIs_using_typespec.md) we have already specified routes and request/response bodies.
The framework [openapi-backend](https://www.npmjs.com/package/openapi-backend) provides an end-to-end solution:

- Routing, error handling and mocking.
- Request (body) validation based on the spec
- Response body validation
- Typesafe using generated type libraries

We can run the framework natively or wrap it in one of popular Node.js backends. This means the codebase is completely portable between Lambda or any other compute.
It has extensive [documentation](https://openapistack.co/docs/openapi-backend/intro/), an active contributor and a decent amount of stars.

## Decision

- Implement our backend using OpenAPI Backend.
- Run a single Lambda (monolith) to process all requests.

## Consequences

- We commit to this framework.
