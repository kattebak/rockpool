# Host frontend applications on S3 with CloudFront

## Status

_accepted_

## Context

Single-page applications (SPAs) built with React, Vue, or similar frameworks need a hosting solution that serves static files globally with low latency.

### Options considered

#### S3 + CloudFront

Static files in S3, served through CloudFront CDN.

Pros:

- Fully serverless, scales automatically
- Global edge locations for low latency
- Cost-effective for static content
- Native AWS integration
- No servers to manage

Cons:

- No server-side rendering without additional infrastructure
- Cache invalidation required for updates

#### AWS Amplify Hosting

Managed hosting service for web applications.

Pros:

- Built-in CI/CD
- Automatic branch deployments
- Server-side rendering support

Cons:

- Less control over infrastructure
- Higher cost than S3/CloudFront
- Vendor abstraction limits customization

#### Vercel / Netlify

Third-party hosting platforms.

Pros:

- Excellent developer experience
- Built-in edge functions
- Automatic deployments

Cons:

- External dependency outside AWS
- Data leaves AWS network
- Additional vendor relationship
- Cost at scale

#### EC2 / ECS with Nginx

Traditional server-based hosting.

Pros:

- Full control
- Server-side rendering native

Cons:

- Operational overhead
- Scaling requires configuration
- Higher cost for static content

## Decision

- Host frontend SPAs on S3 with CloudFront distribution
- Use Origin Access Identity (OAI) to keep S3 bucket private
- Configure CloudFront for SPA routing (404 → index.html)
- Deploy via CI/CD pipeline with cache invalidation

Architecture:

```
CloudFront Distribution
├── Origin: S3 Bucket (private)
├── Default behavior: /public/*
├── Error pages: 403, 404 → /index.html
└── Cache policy: CachingOptimized
```

CDK construct pattern:

```typescript
export class SPADistribution extends Construct {
  readonly distribution: Distribution;
  readonly bucket: Bucket;

  constructor(scope: Construct, id: string, props: SPADistributionProps) {
    // Private S3 bucket
    this.bucket = new Bucket(this, "Bucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
    });

    // CloudFront distribution
    this.distribution = new Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
      ],
    });
  }
}
```

## Consequences

- Zero server maintenance for frontend hosting
- Global distribution with sub-100ms latency
- Cost scales with traffic (typically very low for SPAs)
- Cache invalidation needed after deployments (automated in pipeline)
- Server-side rendering requires separate solution (Lambda@Edge or separate service)
- Custom domains require ACM certificates in us-east-1
