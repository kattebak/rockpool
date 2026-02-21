# ADR-004: Pino for structured logging

**Date**: 2026-02-21
**Status**: Accepted

## Context

We need structured JSON logging for the backend services. Structured logs are searchable, parseable, and integrate with log aggregation tools.

Alternatives considered:

- **Winston**: Feature-rich but heavier, slower in benchmarks.
- **console.log**: No structure, no levels, no redaction.

## Decision

Use **Pino** for all backend logging. Use **pino-pretty** for human-readable output during development.

## Consequences

- All log output is JSON by default, making it easy to pipe into log aggregation.
- Pino is one of the fastest Node.js loggers — negligible overhead in hot paths.
- `pino-pretty` is a dev dependency only; production logs stay machine-readable.
