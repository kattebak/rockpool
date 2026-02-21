# ADR-012: GitHub Actions for CI

**Date**: 2026-02-21
**Status**: Accepted

## Context

We need automated checks for linting, type-checking, tests, and builds. The project is hosted on GitHub.

## Decision

Use **GitHub Actions** for CI. Run linters, tests, and build scripts on every push and PR.

Deployment is out of scope for now — CI only.

## Consequences

- Standard, well-supported CI that runs close to the code.
- Free tier is sufficient for a small project.
- Build scripts must work both locally (`npm run`) and in CI (same commands, no special CI-only paths).
