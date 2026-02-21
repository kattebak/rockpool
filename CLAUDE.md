# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a serverless foundation template built with AWS CDK, TypeSpec, and React. It provides production-ready patterns for API-first development with self-mutating deployment pipelines.

**Key Philosophy**: Spec-first architecture - design in documentation before implementing in code.

## Quick Start

1. **Install dependencies**: `npm install`
2. **Run linting**: `npm test`
3. **Fix issues**: `npm run fix`
4. **Generate API spec**: `make`

## Documentation Structure

### 📘 Development Guides

Essential guides for working with this project:

- **[Development Workflow](./doc/guides/development-workflow.md)** - Spec-first approach, EDDs, Mermaid diagrams
- **[Architecture Overview](./doc/guides/architecture-overview.md)** - Technology stack, components, data flow
- **[Project Structure](./doc/guides/project-structure.md)** - Directory layout, commands, workspace organization
- **[Tooling Reference](./doc/guides/tooling-reference.md)** - CDK patterns, TypeSpec, code style, Git conventions

### 📋 Technical Documentation

- **[Entity Design Documents (EDDs)](./doc/EDD/)** - Feature specifications and implementation plans
- **[Architecture Decision Records (ADRs)](./doc/ADR/)** - Architectural decisions and rationale
- **[Request for Comments (RFCs)](./doc/RFC/)** - System and architectural proposals

### ⚙️ Claude Code Configuration

This project uses `.claude/` for Claude Code configuration:

- **[Agents](/.claude/agents/)** - Specialized sub-agents for implementation tasks
- **[Rules](/.claude/rules/)** - Coding standards (TypeScript, CDK, development)
- **[Templates](/.claude/templates/)** - Document templates for EDDs, ADRs

**Important**: When working on features, read the appropriate guide first:
- Frontend work → [Architecture Overview](./doc/guides/architecture-overview.md)
- Backend work → [Architecture Overview](./doc/guides/architecture-overview.md) + [Tooling Reference](./doc/guides/tooling-reference.md)
- Infrastructure → [Tooling Reference](./doc/guides/tooling-reference.md) + `.claude/rules/cdk.md`

## Critical Conventions

### Before Every Commit

```bash
npm run fix  # ALWAYS run this before committing
```

### Code Style

- **No comments** - Keep code self-explanatory
- **No try/catch** - Let errors bubble to Lambda handler
- **Early returns** - Avoid else statements
- **Kebab-case filenames** - Enforced by Biome
- **Tab indentation** - Configured in biome.json

### TypeScript

- **NEVER use `any`** - Always use proper types
- **Import generated types** - From `@org/openapi-package`, never define manually
- **Functional components only** - Never use class components (React)

### CDK

- **Use subpath imports** - `#stacks/*`, `#constructs/*`, `#lib/*`, `#config/*`
- **Convention over configuration** - Use naming conventions from `src/lib/format.ts`
- **See `.claude/rules/cdk.md`** for comprehensive patterns

## When to Write Documentation

### Write an EDD when:

- Adding features with multiple components
- Designing API endpoints or data models
- Making architectural decisions
- Implementation spans multiple files/packages

### Skip EDD when:

- Fixing obvious bugs
- Small UI tweaks
- Simple CRUD following existing patterns
- Single-file changes

See [Development Workflow](./doc/guides/development-workflow.md) for EDD structure and process.

## Further Reading

- [RFC 001: Serverless Foundation Template](./doc/RFC/001_Serverless_Foundation_Template.md) - Complete system design
- [Architecture Overview](./doc/guides/architecture-overview.md) - Quick architecture reference
- [README.md](./README.md) - Project setup and deployment instructions
