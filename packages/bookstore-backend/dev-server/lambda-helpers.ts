import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import type { Request } from "express";

function normalizePathParams(params: Record<string, string | string[]>): Record<string, string> | null {
	if (!params || Object.keys(params).length === 0) return null;
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(params)) {
		result[key] = Array.isArray(value) ? value[0] : value;
	}
	return result;
}

export function createLambdaEvent(req: Request): APIGatewayProxyEvent {
	return {
		httpMethod: req.method,
		path: req.path,
		pathParameters: normalizePathParams(req.params),
		queryStringParameters: (req.query as { [name: string]: string }) || null,
		headers: (req.headers as { [name: string]: string }) || {},
		body: req.body ? JSON.stringify(req.body) : null,
		isBase64Encoded: false,
		requestContext: {
			requestId: `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			stage: "local",
			httpMethod: req.method,
			path: req.path,
			protocol: "HTTP/1.1",
			requestTime: new Date().toISOString(),
			requestTimeEpoch: Date.now(),
			identity: {
				sourceIp: req.ip || "127.0.0.1",
				userAgent: req.get("User-Agent") || "local-test",
				accessKey: null,
				accountId: null,
				apiKey: null,
				apiKeyId: null,
				caller: null,
				cognitoAuthenticationProvider: null,
				cognitoAuthenticationType: null,
				cognitoIdentityId: null,
				cognitoIdentityPoolId: null,
				principalOrgId: null,
				user: null,
				userArn: null,
				clientCert: null,
			},
			accountId: "123456789012",
			apiId: "local",
			domainName: "localhost",
			domainPrefix: "local",
			resourceId: "local",
			resourcePath: req.path,
			authorizer: undefined,
		},
		resource: req.path,
		multiValueHeaders: {},
		multiValueQueryStringParameters: null,
		stageVariables: null,
	};
}

export function createLambdaContext(): Context {
	return {
		callbackWaitsForEmptyEventLoop: false,
		functionName: "bookstore-backend-local",
		functionVersion: "$LATEST",
		invokedFunctionArn:
			"arn:aws:lambda:local:123456789012:function:bookstore-backend-local",
		memoryLimitInMB: "128",
		awsRequestId: `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
		logGroupName: "/aws/lambda/bookstore-backend-local",
		logStreamName: `${new Date().toISOString().split("T")[0]}/[$LATEST]${Math.random().toString(36).substr(2, 9)}`,
		getRemainingTimeInMillis: () => 30000,
		done: () => {},
		fail: () => {},
		succeed: () => {},
	};
}
