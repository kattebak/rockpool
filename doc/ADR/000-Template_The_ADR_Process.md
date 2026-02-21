# ADR-000: Template and ADR Process

**Date**: 2026-02-21
**Status**: Accepted

## Context

We need a lightweight way to record architecture decisions so they are discoverable and consistent across the project.

We use the Michael Nygard format (Title, Status, Context, Decision, Consequences) as described in "Documenting Architecture Decisions".

## Decision

Each ADR is a markdown file in `doc/ADR/` named `NNN-short-description.md`.

### Template

```markdown
# ADR-NNN: [Short title of decision]

**Date**: YYYY-MM-DD
**Status**: [Proposed | Accepted | Deprecated | Superseded by ADR-NNN]

## Context

What is the issue that we're seeing that is motivating this decision or change?

## Decision

What is the change that we're proposing and/or doing?

## Consequences

What becomes easier or more difficult to do because of this change?
```

### Rules

- One decision per ADR
- Number sequentially (001, 002, ...)
- Once accepted, do not modify the Context or Decision sections
- If a decision is reversed, write a new ADR and mark the old one as "Superseded by ADR-NNN"
- Keep it short

## Consequences

All significant architecture decisions are recorded in version control alongside the code they apply to.
