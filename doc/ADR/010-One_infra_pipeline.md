# Deploy ALL infrastructure code in a single pipeline

## Status

_accepted_

## Context

We need to create new (application deploy) pipelines that can deploy Lambda backend code to every stage.
This pipeline will trigger a deploy for each push to the repo (we can adjust this and add filtering for paths) to each stage.

Core application infrastructure, CI/CD infrastructure and Observability can be considered separate concerns. We may also need secondary systems - a BFF calling our core APIs, for example. We want to follow the CDK best practice "Move code into repositories based on code lifecycle or team ownership"

> When packages begin to be used in multiple applications, move them to their own repository. This way, the packages can be referenced by application build systems that use them, and they can also be updated on cadences independent of the application lifecycles. However, at first it might make sense to put all shared constructs in one repository.

### Options considered

Currently contemplating how to provision the pipeline:

#### 1. Create a separate CDK app for deployment pipelines

Pros:

- Scalable pattern: we can do a similar trick for alarms and other aux systems
- Proven approach

Cons:

- Proliferation of pipelines.
- Each pipeline needs to be bootstrapped from a dev machine
- Increase in complexity

#### 2. Create deployment stages in the current pipeline

Pros:

- One pipeline to deploy all infrastructure, including CI/CD infra.
- Recommended pattern by AWS: one repo, one pipeline to avoid unintended breakage.

Cons:

- The infra pipeline will take longer to complete and it can get huge.

## Decision

Experience has shown that while infra deploy timelines are a concern initially, downstream they become less of a concern as activity winds down on new infrastructure. Stages can be re-ordered: new stages can be moved to the front of the pipeline initially. Sticking to the "Move code into repositories based on code lifecycle or team ownership" we currently have one team, one ownership, in a single lifecycle.

- Deploy all infrastructure in the main infra pipeline
- Separate different types of infrastructure using the "Wave" and "Stage" constructs

## Consequences

- This is a 2-way door decision with a small caveat: pipelines and alarms are _stateful_ because we want to retain the ability to investigate historical events.
