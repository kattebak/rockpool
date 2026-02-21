# Serverless backends

## Status

_accepted_

## Context

Organizations historically run their compute workloads on (semi) unmanaged infrastructure, resulting in architectures like a single Kubernetes cluster in a single VPC.
Moving webserver backends to serverless has the benefit of reducing the fixed cost of ownership for container orchestration infrastructure.

## Decision

- We build new webservices on AWS Lambda, unless there is a clear business requirement to do otherwise.
- If Lambda is too constrained, pick other serverless compute that fits the workload (Fargate, AWS Batch, AWS CodeBuild, etc.)
- We prefer "the most serverless": Kinesis over MSK, Aurora CDC over Debezium, etc.

## Consequences

- We accept vendor lock-in on the infrastructure level
- We run our application backends on AWS Lambda
- We prefer native vendor solutions over third party wrappers
