# Apply multi account strategy

## Status

_accepted_

## Context

From the AWS whitepaper "[Organizing Your AWS Environment Using Multiple Accounts](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/organizing-your-aws-environment.html)":

> Using multiple AWS accounts to help isolate and manage your business applications and data can help you optimize across most of the AWS Well-Architected Framework pillars including operational excellence, security, reliability, and cost optimization.

We want to separate development and production accounts to create a data perimeter and organize access levels. Additionally we want to separate tooling (CI/CD) from application environments.

For this template, we identify three baseline environments: preprod, production, and tooling.

## Decision

- We setup new infrastructure using the multi-account approach.
- The three environments production, preprod, and tooling are distinct accounts.
- Access to these accounts follows the "Principle of Least Privilege" (PoLP).

## Non-decision

There are few things we explicitly exclude from this decision because they are beyond the scope of this project:

- New projects should follow the same pattern, using their own set of distinct accounts.

## Consequences

- There is additional complexity associated with this approach.
- We accept the friction of not having access to everything all the time.
