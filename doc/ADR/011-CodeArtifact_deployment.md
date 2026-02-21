# Deploy package artifacts to CodeArtifact

## Status

_proposed_

## Context

Using typespec, we generate various artifacts, like OpenAPI schema (wrapped in an npm package), DynamoDB model definitions and clients for Python, Node.js and PHP. Today, we generate those packages on the fly for each build of the backend and infrastructure.

In order to share the packages outside of this repository, and to speed up the build, we want to generate packages only when needed, and push them to CodeArtifact. All other code will then consume them from CodeArtifact.

## Decision

We will use CodeArtifact as our primary artifact store. The CodeArtifact repository will live in the _management_ account. We will provide _readonly_ access to all the accounts managed in our configuration, reducing friction for developers.

The repository will use a namespace scoped to the organization.

## Consequences

- Developers _must_ execute a login script each morning to authenticate if they want to install packages (the standard expiry is 12 hours).
- We need to provision permissions for CI/CD to pull packages from the repository.

## Implementation plan

- Create a new deploy stack, deployed by the pipeline, that provisions CodeArtifact, and a CodeBuild job that is triggered from the repository.
- CodeBuild should only be triggered for changes in the buildspec, Makefile, and typespec directory.
- The CodeBuild job should run on CodeBuild managed compute, because Makefile won't work on a Lambda job.
- The CodeBuild job uses a buildspec.codeartifact.yaml file in the root of this repository.
