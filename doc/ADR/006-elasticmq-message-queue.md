# ADR-006: ElasticMQ for message queue

**Date**: 2026-02-21
**Status**: Accepted
**Updated**: 2026-03-03

## Context

The workspace lifecycle (create, start, stop, destroy) involves async operations that should be decoupled from the API request path. We need a message queue for the Workspace Worker to consume jobs.

Requirements:

- Runs locally and self-hosted (no cloud dependency).
- Simple queue semantics (enqueue, dequeue, visibility timeout, dead-letter).
- Familiar API for anyone who has used SQS.

Alternatives considered:

- **Redis + BullMQ**: Heavier, requires Redis server, more features than needed.
- **RabbitMQ**: Full AMQP broker, overkill for a handful of job types.
- **Custom file/SQLite queue**: Reinventing the wheel.

## Decision

Use **ElasticMQ** as the message queue. It runs as a container (`softwaremill/elasticmq-native`) in the `podman compose` stack alongside the other control plane services.

The Workspace Service enqueues jobs; the Workspace Worker polls and processes them. Standard SQS SDK (`@aws-sdk/client-sqs`) is used as the client.

## Consequences

- Local-first: runs as a container in the compose stack alongside the other control plane services.
- SQS-compatible: if we ever move to AWS, swapping to real SQS is a config change.
- In-memory by default — messages are lost on restart. Acceptable for workspace lifecycle jobs which can be retried or reconciled.
- No Java dependency on the host — the `elasticmq-native` container image is a GraalVM native binary.
