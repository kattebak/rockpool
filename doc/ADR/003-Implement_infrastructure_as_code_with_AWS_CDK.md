# Implement infrastructure as code with AWS CDK

## Status

_accepted_

## Context

Infrastructure as code (IaC) is a best practice promoted by cloud vendors ([Microsoft](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/infrastructure-as-code-design), [AWS](https://docs.aws.amazon.com/wellarchitected/latest/devops-guidance/dl.eac.1-organize-infrastructure-as-code-for-scale.html), [GCP](https://cloud.google.com/docs/terraform/iac-overview)) that allows us to automate, audit, scale (the human factor) and save cost, and helps to improve our security posture and audit process.

Because we deploy on AWS, CDK is a logical choice. The AWS CDK is a set of language constructs for Java, Typescript or Python that use CloudFormation as a compile-target. Using CDK we can describe our entire infrastructure in a single codebase.

### Vendor agnostic vs CDK

A vendor agnostic alternative like Terraform/Pulumi builds on top of the same CloudFormation layer. Because our serverless architecture is vendor specific, a cloud agnostic vendor such as Terraform does not prevent vendor lock-in.

### Typescript vs Python vs Java

TypeScript is widely adopted in full-stack development, and the TypeScript version of CDK has the biggest ecosystem of third party constructs, tooling and documentation.

## Decision

- We use AWS CDK in Typescript to define all infrastructure.
- There will be no manual provisioning of resources in the console.
- All infrastructure changes will be deployed through a pipeline.
- All infrastructure changes must follow the common code review process.

## Consequences

- All engineers with commit access can deploy infrastructure.
- We do not tolerate manual configuration changes, whatsoever.
- CDK becomes part of our standard tooling.
