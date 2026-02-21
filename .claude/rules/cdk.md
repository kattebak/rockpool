# AWS CDK Standards

## Project Structure

### Directory Layout

```
src/
├── app/                    # CDK app entry points
├── config/                 # Stage configurations
├── lib/                    # Utility functions (format.ts, etc.)
├── constructs/             # Reusable CDK constructs by category
│   ├── apigateway/
│   ├── lambda/
│   ├── dynamodb/
│   ├── cognito/
│   └── role/
└── stacks/                 # CDK stacks organized by application
    └── <app-name>/
        ├── pipeline.ts     # Self-mutating pipeline (root stack)
        └── <stage>/
            ├── stage.ts
            └── stacks/
```

### Import Patterns

Use subpath imports configured in `tsconfig.json`:

```typescript
// Good - use subpath imports
import { formatTableName } from "#lib/format.js";
import { NodeJSArmLambda } from "#constructs/lambda/nodejs-arm.js";
import config from "#config/main.js";

// Bad - relative imports
import { formatTableName } from "../../lib/format";
```

## Naming Conventions

### Stack Naming (PascalCase with App Prefix and Type Suffix)

```typescript
// Format: [AppPrefix][Component][TypeSuffix]
class RNGPortalRestAPIStack extends Stack { }
class RNGPortalDynamoDBStack extends Stack { }
class RNGPortalFrontendStack extends Stack { }
```

### Construct Naming (PascalCase with Type Suffix)

```typescript
class NodeJSArmLambdaFunction extends Function { }
class DynamoDBTableV2 extends TableV2 { }
class APIGatewayOpenAPI extends Construct { }
```

### File Naming (kebab-case)

```typescript
// Good
nodejs-arm-lambda.ts
cross-account-role.ts
deploy-lambda.ts

// Bad
NodeJSArmLambda.ts
nodeJSArmLambda.ts
```

### Formatting Functions

Create formatting functions in `src/lib/format.ts` for consistent resource naming:

```typescript
export const formatTableName = ({ stageName }: { stageName: string }) =>
  `${stageName}-portal-backend`;

export const formatFunctionName = ({ stageName }: { stageName: string }) =>
  `${stageName}-portal-backend`;

export const formatParameterName = ({ stageName }: { stageName: string }) =>
  `/${stageName}/portal/distribution-id`;
```

## Stack Hierarchy

### Pipeline Pattern (Self-Mutating)

```typescript
class PortalToolStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const synth = new CodeBuildStep("Synth", {
      input: CodePipelineSource.connection(`${owner}/${repository}`, branch, {
        connectionArn,
      }),
      commands: ["npm ci", "npm run cdk:synth"],
    });

    const pipeline = new CodePipeline(this, "Pipeline", {
      useChangeSets: false,
      publishAssetsInParallel: false,
      crossAccountKeys: true,
      synth,
    });

    pipeline.addStage(new PortalStage(this, `${stageName}-portal`, props));
  }
}
```

### Stage Pattern

```typescript
interface PortalStageProps extends StageProps {
  stageName: string;
  toolingAccount: string;
}

export class PortalStage extends Stage {
  constructor(scope: Construct, id: string, props: PortalStageProps) {
    super(scope, id, props);

    const stageConfig = config.stages.find((s) => s.stageName === props.stageName);
    if (!stageConfig) {
      throw new Error(`Stage config not found for ${props.stageName}`);
    }

    // Create stacks in dependency order
    const { tableName } = new DynamoDBStack(this, "DynamoDB", props);

    new RestAPIStack(this, "RestAPI", { ...props, tableName });
  }
}
```

### Stack Interface Pattern

```typescript
interface RestAPIStackProps extends StackProps {
  stageName: string;
  tableName: string;
  toolingAccount: string;
}

export class RestAPIStack extends Stack {
  constructor(scope: Construct, id: string, props: RestAPIStackProps) {
    super(scope, id, props);

    const { stageName, tableName, toolingAccount } = props;
    // Implementation
  }
}
```

## Props and Interface Design

### Props Definition

```typescript
// Extend appropriate base Props
interface NodeJSArmLambdaProps
  extends Pick<FunctionProps, "role" | "loggingFormat" | "onFailure"> {
  functionName?: string;
  handler: string;
  memorySize?: number;
  timeout?: Duration;
}

// Use Pick to inherit specific properties from parent
// Make optional properties explicit with ?
// Group related properties logically
```

## Configuration Management

### Stage Configuration

```typescript
// src/config/main.ts
export default {
  aws: {
    region: "eu-central-1",
    accountId: "123456789012",
  },
  github: {
    repository: "my-app",
    owner: "my-org",
    branch: "main",
    connectionArn: "arn:aws:codeconnections:...",
  },
  stages: [
    {
      stageName: "dev",
      account: "234567890123",
      region: "eu-central-1",
      // Stage-specific configuration
    },
  ],
};
```

### Configuration Access

```typescript
const stageConfig = config.stages.find((s) => s.stageName === props.stageName);

if (!stageConfig) {
  throw new Error(`Stage config not found for ${props.stageName}`);
}
```

## Core Construct Patterns

### Lambda Function Construct

```typescript
export class NodeJSArmLambdaFunction extends Fn {
  constructor(scope: Construct, id: string, props: NodeJSArmLambdaProps) {
    const { functionName, handler, memorySize, timeout, code } = props;

    // Validate function name length (AWS limit is 64 chars)
    assert(
      (functionName ?? "").length < 64,
      `Expected ${functionName} to be less than 64 characters`,
    );

    super(scope, id, {
      ...props,
      memorySize: memorySize ?? 2048,
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: timeout ?? Duration.seconds(2),
      handler,
      loggingFormat: LoggingFormat.JSON,
      tracing: Tracing.ACTIVE,
      code: code ?? Code.fromInline(`
        exports.handler = async (event, context) => {
          throw new Error("No code provided");
        }
      `),
    });

    this.addEnvironment("NODE_OPTIONS", "--enable-source-maps");
    this.addEnvironment("NODE_ENV", "production");
  }
}
```

### DynamoDB Construct

```typescript
export class DynamoDBTableV2 extends TableV2 {
  constructor(scope: Construct, id: string, props: DynamoDBTableV2Props) {
    super(scope, id, {
      tableName: props.tableName,
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      dynamoStream: StreamViewType.NEW_AND_OLD_IMAGES,
      billing: Billing.onDemand(),
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });
  }
}

// Use standardized key naming:
// - pk/sk for main keys
// - lsi{n}sk for local secondary index sort keys
// - gsi{n}pk/gsi{n}sk for global secondary index keys
```

## Cross-Account Patterns

### Cross-Account IAM Roles

Create TWO role classes for cross-account access:

```typescript
// Role in APPLICATION account (can be assumed)
export class DeployLambdaCrossAccountAssumeRole extends Role {
  constructor(scope: Construct, id: string, props: Props) {
    const { stageName, toolingAccount, env } = props;

    super(scope, id, {
      roleName: `${stageName}-deploy-lambda-from-${toolingAccount}`,
      assumedBy: new ArnPrincipal(
        `arn:aws:iam::${toolingAccount}:role/${stageName}-deploy-lambda-in-${env.account}`,
      ),
      inlinePolicies: {
        UpdateFunctionCodePolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ["lambda:UpdateFunctionCode"],
              resources: [`arn:aws:lambda:${env.region}:${env.account}:function:${stageName}-*`],
            }),
          ],
        }),
      },
    });
  }
}

// Role in TOOLING account (assumes the other role)
export class DeployLambdaCrossAccountRole extends Role {
  constructor(scope: Construct, id: string, props: Props) {
    const { stageName, account, toolingAccount } = props;

    super(scope, id, {
      assumedBy: new ServicePrincipal("codebuild.amazonaws.com"),
      roleName: `${stageName}-deploy-lambda-in-${account}`,
    });

    this.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["sts:AssumeRole"],
        resources: [
          `arn:aws:iam::${account}:role/${stageName}-deploy-lambda-from-${toolingAccount}`,
        ],
      }),
    );
  }
}
```

## Value Sharing Between Stacks

### Method 1: Direct Object Return (Same Stage)

```typescript
const { tableName } = new DynamoDBStack(this, "DynamoDB", props);
new RestAPIStack(this, "RestAPI", { ...props, tableName });
```

### Method 2: SSM Parameters (Cross-Account)

```typescript
// Publishing stack
const param = new StringParameter(this, "ApiIdParam", {
  parameterName: `/${stageName}/portal/api-id`,
  stringValue: api.restApiId,
});
param.grantRead(new AccountPrincipal(toolingAccount));

// Consuming code uses cdk.context.json or SSM lookup
```

### Method 3: CloudFormation Exports

```typescript
this.exportValue(this.tableName);
this.exportValue(this.tableArn);
```

## Environment and Secret Management

### Lambda Environment Variables

```typescript
handler.addEnvironment("DYNAMODB_TABLE_NAME", tableName);
handler.addEnvironment("S3_BUCKET_NAME", bucket.bucketName);
```

### Secrets Manager Integration

```typescript
const apiKey = new Secret(this, "ApiKey", {
  secretName: `${stageName}/portal/api-key`,
});

apiKey.grantRead(handler);
```

### SSM Parameters

```typescript
const param = new StringParameter(this, "Param", {
  parameterName: `/${stageName}/portal/resource-id`,
  stringValue: resource.id,
});
```

## Testing Patterns

### CDK Assertion Testing

```typescript
describe("RestAPIStack", () => {
  it("creates IAM role with correct service principal", () => {
    const stack = new RestAPIStack(new App(), "Test", props);
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [{
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: { Service: "apigateway.amazonaws.com" },
        }],
      },
    });
  });

  it("applies Retain deletion policy", () => {
    const stack = new RestAPIStack(new App(), "Test", props);
    const template = Template.fromStack(stack);

    template.hasResource("AWS::IAM::Role", {
      DeletionPolicy: "Retain",
    });
  });
});
```

## Key Design Principles

### Convention Over Configuration

- Use naming conventions for resource IDs
- Consistent parameter naming hierarchy: `/{stageName}/{app}/{resource}`
- Standard key naming for DynamoDB (pk, sk, gsi{n}pk, gsi{n}sk)

### Never Reuse Stacks Across Stages

Each stage gets its own stack instances. Use `stageName` parameter to differentiate resources.

### Fail Fast

Validate inputs during synthesis:

```typescript
assert(
  (functionName ?? "").length < 64,
  `Function name ${functionName} exceeds 64 character limit`,
);
```

### Multi-Account Architecture

- Tooling account runs pipelines
- Application accounts host resources
- Use cross-account roles for deployment
- Validate permissions at synthesis time

### Type Safety

- Always define Props interfaces
- Extend appropriate base Props (StackProps, etc.)
- Use destructuring for clarity

### Sensible Defaults

- Lambda: ARM64 architecture, 2048 MB memory, JSON logging, X-Ray tracing
- DynamoDB: On-demand billing, PITR enabled, RETAIN removal policy
- CloudFront: Compress enabled, HTTPS redirect

## Common Patterns

### Region-Specific Resources

```typescript
// CloudFront certificates must be in us-east-1
new CertificateStack(this, "Cert", {
  ...props,
  crossRegionReferences: true,
  env: { ...props.env, region: "us-east-1" },
});
```

### Conditional Stack Creation

```typescript
if (stageConfig.feature?.enabled) {
  new FeatureStack(this, "Feature", props);
}
```

### Stack Dependencies

```typescript
const monitoring = new MonitoringStack(this, "Monitoring", props);
monitoring.addDependency(apiStack);
monitoring.addDependency(dbStack);
```
