# Use ARM64 architecture for Lambda functions

## Status

_accepted_

## Context

AWS Lambda supports two processor architectures: x86_64 (Intel/AMD) and arm64 (AWS Graviton2). The choice of architecture affects cost, performance, and compatibility.

### Cost comparison

AWS prices ARM64 Lambda functions approximately 20% lower than x86_64 for the same memory configuration. For compute-intensive workloads, this translates directly to cost savings.

### Performance characteristics

Graviton2 processors offer better price-performance for most workloads:

- Single-threaded performance is comparable to x86_64
- Memory bandwidth is higher on Graviton2
- Cold start times are similar between architectures
- Node.js runtime performance is equivalent or better on ARM64

### Compatibility considerations

Most Node.js packages work without modification on ARM64. Native dependencies (compiled C/C++ addons) require ARM64-compatible binaries. The npm ecosystem has largely adopted ARM64 support.

Packages with native dependencies that support ARM64:

- Sharp (image processing)
- bcrypt
- node-sass (deprecated, but works)
- Most AWS SDK components

## Decision

- All Lambda functions will use ARM64 (Graviton2) architecture by default
- Use x86_64 only when a critical dependency lacks ARM64 support
- Document any x86_64 exceptions with justification

## Consequences

- 20% reduction in Lambda compute costs
- Slightly better performance for memory-bound workloads
- Rare compatibility issues with native dependencies require attention during dependency updates
- Local development on x86 machines remains unaffected (Node.js handles architecture differences)
