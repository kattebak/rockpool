# Use DynamoDB as our primary database

## Status

_accepted_

## Context

Serverless CRUD applications require a database that integrates well with AWS Lambda. We need a cost-effective and easy to integrate managed database solution. Both NoSQL (DynamoDB) and managed SQL (Aurora) are viable options from a data modeling perspective.

### Options considered

Before making this choice we considered three options: DynamoDB with ElectroDB ORM, AWS Distributed SQL (DSQL), and Aurora Serverless V2.

#### AWS DSQL

AWS DSQL was announced in 2024 and is available in limited regions. While it could be a very viable solution in the future, the lack of support for Aurora DB activity streams and limited regional availability are blockers.

Pros:

- Completely managed, and simple
- Native IAM authentication makes it a great fit
- SQL based with near infinite scale
- Scales from zero to infinite

Cons:

- Lacks traditional PostgreSQL features compared to other SQL based DBs
- Limited regional availability
- No support for Aurora Database Activity Streams

#### Aurora Serverless V2

Despite the name, Aurora Serverless still requires you to manage capacity. To connect serverless compute you can either expose a public endpoint (to a limited CIDR) out of the VPC, or launch a Lambda into the VPC and provision a NAT gateway.
The additional complexity makes Aurora Serverless a less than perfect option for a serverless backend. The extra infrastructure adds latency and cost.

Pros:

- Real SQL
- Fast and reliable. AWS manages the infrastructure.
- Supports Aurora Database Activity Streams for search indexing and pubsub.

Cons:

- Needs a VPC, and a NAT Gateway or public endpoint to talk to a serverless backend.
- Doesn't scale to zero, and may get pricey under load.
- Requires monitoring and managing capacity.

#### AWS DynamoDB

AWS DynamoDB is the staple database for serverless applications and also heavily used by AWS internally. It is extremely reliable, while still offering single digit response times on direct key lookups. Using the ElectroDB ORM, we can leverage the single table design to create a developer experience that is close to using a traditional ORM/query builder with SQL.

Pros:

- Fast and reliable.
- Supports DynamoDB activity streams for search indexing and pubsub.
- Scales from zero to infinite
- Global tables allow multi-region support.

Cons:

- No SQL
- ElectroDB stores data in a peculiar format, making it hard to query the data outside of application code.

### Options not considered

#### AWS DocumentDB

AWS DocumentDB is a wrapped version of MongoDB and doesn't offer any advantages over DynamoDB or Aurora.

#### AWS Neptune

AWS Neptune is a graph database. While some data may be graph-shaped, there are no good datapoints to accept the additional complexity introduced by Neptune.

## Decision

- Use DynamoDB as our primary database
- Apply the single-table-design pattern
- Use ElectroDB as our ORM for Typescript
- Use DynamoDB streams to implement pub-sub and search indexing

## Consequences

- Engineers need to familiarize themselves with the technology.
- Our database isn't portable, and cannot be consumed as SQL by other clients.
- We optimize for low cost, low maintenance and low overhead over familiarity.
