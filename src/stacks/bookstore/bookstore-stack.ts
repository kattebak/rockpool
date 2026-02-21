import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
	AllowedMethods,
	Distribution,
	OriginAccessIdentity,
	ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import type { UserPool } from "aws-cdk-lib/aws-cognito";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { APIGatewayOpenAPI } from "#constructs/apigateway/openapi.js";
import { BookstoreUserPool } from "#constructs/cognito/userpool.js";
import { DynamoDBTableV2 } from "#constructs/dynamodb/table.js";
import { NodeJSArmLambdaFunction } from "#constructs/lambda/nodejs-arm-lambda.js";
import {
	formatApiName,
	formatBucketName,
	formatCognitoDomainPrefix,
	formatFunctionName,
	formatTableName,
	formatUserPoolName,
} from "#lib/format.js";
import OpenAPISpec from "../../../build/bookstore-openapi3/openapi.json" with { type: "json" };

export interface BookstoreStackProps extends StackProps {
	username: string;
	callbackUrls?: string[];
	logoutUrls?: string[];
	allowedOrigins?: string[];
}

export class BookstoreStack extends Stack {
	public readonly table: DynamoDBTableV2;
	public readonly handler: NodeJSArmLambdaFunction;
	public readonly userPool: UserPool;
	public readonly api: APIGatewayOpenAPI;

	constructor(scope: Construct, id: string, props: BookstoreStackProps) {
		super(scope, id, props);

		const {
			username,
			callbackUrls = ["http://localhost:3000/callback"],
			logoutUrls = ["http://localhost:3000/logout"],
			allowedOrigins = ["http://localhost:3000"],
		} = props;

		this.table = this.createTable(username);
		const { userPool } = this.createUserPool(username, callbackUrls, logoutUrls);
		this.userPool = userPool;
		this.handler = this.createHandler(username, this.table);
		this.api = this.createApiGateway(username, this.handler, userPool, allowedOrigins);
		this.createFrontend(username);
	}

	private createTable(username: string): DynamoDBTableV2 {
		const tableName = formatTableName({ username });

		const table = new DynamoDBTableV2(this, "Table", {
			tableName,
		});

		table.addGlobalIndex();

		return table;
	}

	private createUserPool(
		username: string,
		callbackUrls: string[],
		logoutUrls: string[],
	): BookstoreUserPool {
		return new BookstoreUserPool(this, "UserPool", {
			stageName: username,
			userPoolName: formatUserPoolName({ username }),
			cognitoDomainPrefix: formatCognitoDomainPrefix({ username }),
			callbackUrls,
			logoutUrls,
		});
	}

	private createHandler(
		username: string,
		table: DynamoDBTableV2,
	): NodeJSArmLambdaFunction {
		const functionName = formatFunctionName({ username });

		const handler = new NodeJSArmLambdaFunction(this, "Handler", {
			functionName,
			handler: "index.handler",
		});

		table.grantReadWriteData(handler);
		handler.addEnvironment("DYNAMODB_TABLE_NAME", table.tableName);
		handler.addEnvironment("USERNAME", username);

		return handler;
	}

	private createApiGateway(
		username: string,
		handler: IFunction,
		userPool: UserPool,
		allowedOrigins: string[],
	): APIGatewayOpenAPI {
		return new APIGatewayOpenAPI(this, "API", {
			name: formatApiName({ username }),
			handler,
			openApiSpec: JSON.stringify(OpenAPISpec),
			allowedOrigins,
			templateVariables: {
				HandlerFunctionName: handler.functionName,
				CognitoUserPoolArn: userPool.userPoolArn,
			},
		});
	}

	private createFrontend(username: string): Distribution {
		const websiteBucket = new Bucket(this, "WebsiteBucket", {
			bucketName: formatBucketName({ username }),
			removalPolicy: RemovalPolicy.DESTROY,
			autoDeleteObjects: true,
			blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
			enforceSSL: true,
		});

		const originAccessIdentity = new OriginAccessIdentity(this, "OAI");

		const distribution = new Distribution(this, "Distribution", {
			defaultRootObject: "index.html",
			errorResponses: [
				{
					httpStatus: 403,
					responseHttpStatus: 200,
					responsePagePath: "/index.html",
					ttl: Duration.minutes(5),
				},
			],
			defaultBehavior: {
				origin: S3BucketOrigin.withOriginAccessIdentity(websiteBucket, {
					originAccessIdentity,
					originPath: "/public",
				}),
				compress: true,
				allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
				viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
			},
		});

		return distribution;
	}
}
