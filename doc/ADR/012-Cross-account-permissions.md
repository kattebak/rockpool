# Cross account permissions

## Status

_accepted_

## Context

In a multi-account AWS architecture, external teams and services need to consume data and APIs from our application. This typically involves:

1. Consuming data from Kinesis streams (pub-sub)
2. Calling APIs using read-only credentials

To achieve high operational stability and confidence, we want to test these integrations across all stages where external systems are integrated.

### Stage mapping

When integrating with external systems, you need to map your application stages to their environments. A typical mapping looks like:

| App Stage | Consumer Stage | Description                                                      |
| --------- | -------------- | ---------------------------------------------------------------- |
| dev       | development    | Used in local development, experimentation, first deployment     |
| alpha     | testing        | High fidelity, non-production stage for testing and validation   |
| beta      | staging        | Like production, monitored, not expected to serve prod workloads |
| prod      | production     | Monitored production stage with production data                  |

## Decision

### Kinesis stream permissions

For each consumer that needs access to Kinesis streams, we deploy resource-based policies that grant access to their Lambda execution role:

| App Stage | Consumer Stage | Kinesis ARN                                                        | Consumer Role                                                     |
| --------- | -------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| dev       | development    | N/A                                                                | N/A                                                               |
| alpha     | testing        | arn:aws:kinesis:{region}:{account}:stream/{stage}-{app}-pubsub     | arn:aws:iam::{consumer-account}:role/{stage}-Kinesis-Consumer-Role |
| beta      | staging        | arn:aws:kinesis:{region}:{account}:stream/{stage}-{app}-pubsub     | arn:aws:iam::{consumer-account}:role/{stage}-Kinesis-Consumer-Role |
| prod      | production     | arn:aws:kinesis:{region}:{account}:stream/{stage}-{app}-pubsub     | arn:aws:iam::{consumer-account}:role/{stage}-Kinesis-Consumer-Role |

Consumers use the Kinesis consumer role as their Lambda execution role. See [AWS resource-based policy examples](https://docs.aws.amazon.com/streams/latest/dev/resource-based-policy-examples.html).

### API Gateway permissions

For read-only API access, we create IAM roles that can be assumed by external accounts:

| App Stage | Consumer Stage | App Role ARN                                                                    | Consumer Principal                     |
| --------- | -------------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| dev       | development    | N/A                                                                             | N/A                                    |
| alpha     | testing        | arn:aws:iam::{account}:role/readonly-invoke-{stage}-{app}-by-{consumer}-{stage} | arn:aws:iam::{consumer-account}:root   |
| beta      | staging        | arn:aws:iam::{account}:role/readonly-invoke-{stage}-{app}-by-{consumer}-{stage} | arn:aws:iam::{consumer-account}:root   |
| prod      | production     | arn:aws:iam::{account}:role/readonly-invoke-{stage}-{app}-by-{consumer}-{stage} | arn:aws:iam::{consumer-account}:root   |

Consumers use STS assume-role to retrieve temporary credentials needed to invoke the API.

### CodeArtifact access

Additionally, provide read-only access to your CodeArtifact repository to consuming organizations, allowing them to consume generated clients (Node.js, Python, etc.).

## Consequences

- External consumers may access data from configured stages
- External consumers have an operational dependency on your application stages
- Root credentials enable any authenticated principal from the consumer account to call APIs (acceptable for read-only access)
- Kinesis streams remain tightly controlled since they are limited resources

## Appendix: Configuring clients

### Node.js client with temporary credentials

```typescript
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { AwsClient } from "aws4fetch";

export const getClient = async (basePath: string) => {
  const provider = fromTemporaryCredentials({
    params: {
      RoleArn: process.env.AWS_ROLE_ARN,
      RoleSessionName: "api-session",
    },
  });

  const credentials = await provider();
  const aws = new AwsClient(credentials);
  const fetch = aws.fetch.bind(aws);

  // Use fetch with your API client
  return { fetch, basePath };
};
```

### Python client with temporary credentials

```python
from requests_aws4auth import AWS4Auth
from botocore.session import Session

credentials = Session().get_credentials()
auth = AWS4Auth(
    region='eu-central-1',
    service='execute-api',
    refreshable_credentials=credentials
)
```

See [requests-aws4auth](https://pypi.org/project/requests-aws4auth/) and [boto3 credentials](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/credentials.html#assume-role-provider).

### CDK snippet for Kinesis consumer role

```typescript
import { Role, ServicePrincipal, ManagedPolicy } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface KinesisConsumerRoleProps {
  stageName: string;
}

export class KinesisConsumerRole extends Role {
  constructor(scope: Construct, id: string, props: KinesisConsumerRoleProps) {
    super(scope, id, {
      roleName: `${props.stageName}-Kinesis-Consumer-Role`,
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaKinesisExecutionRole"),
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });
  }
}
```

## FAQ

### 1. Why allow root credentials to call the API?

Root credentials enable any authenticated principal from the account to call our APIs. This is an acceptable security posture for read-only access, especially when the goal is to provide organization-wide access to canonical data.

### 2. Why not allow root credentials for Kinesis?

Kinesis streams are a limited resource that we want to control access to. Explicit role-based access provides better auditability and control.

### 3. Why not connect dev stage to external consumers?

The dev stage is used for local development and experimentation. It's unstable and may break on purpose. External integrations should only target higher fidelity stages.
