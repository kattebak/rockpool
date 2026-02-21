# Model APIs using typespec

## Status

_accepted_

## Context

We want our software to follow the [design by contract](https://en.wikipedia.org/wiki/Design_by_contract) paradigm, so that we can build robust and well defined service architectures that integrate well. The first step is to always define the "contract", then to extend those to other formats like REST (OpenAPI), interfaces (Typescript, JSONSchema) and binary protocol serialisation (AVRO, Protobuf).

Typespec is a service definition language (SDL) that offers a way to write contracts that can then be easily converted into other SDLs. Typespec has built in emitters for Protobuf, JSONSchema and OpenAPI. Compared to OpenAPI/JSONSchema (YAML notation), gRPC (assumption of RPC-style), and Smithy (the SDL from AWS), typespec offers amazing ergonomics (IDE extensions using the LSP protocol) and mature tooling.

## Decision

- We define interfaces in Typespec
- We define (Open)API specifications using Typespec
- We bias to use our spec to generate interfaces, code, types and SDKs.

## Consequences

- We have a well defined "source of truth" for each service
- We define types before we start coding
- Typespec is part of our core tooling
