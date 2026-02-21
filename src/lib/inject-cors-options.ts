type Operation = {
	operationId: string;
	parameters?: Array<unknown>;
};

type Handler = {
	get?: Operation;
	post?: Operation;
	put?: Operation;
	delete?: Operation;
	options?: Operation;
};

type OpenAPISpec = {
	paths: Record<string, Handler>;
};

export function injectCorsOptionsHandlers({
	openApiSpec,
	allowedOrigins,
}: {
	openApiSpec: OpenAPISpec;
	allowedOrigins: string[];
}): OpenAPISpec {
	for (const [path, handler] of Object.entries(openApiSpec.paths) as [
		keyof typeof openApiSpec.paths,
		Handler,
	][]) {
		const key =
			handler.get?.operationId ||
			handler.post?.operationId ||
			handler.delete?.operationId ||
			handler.put?.operationId;

		if (!key) {
			throw new Error(`Invalid OpenAPI spec: Missing operationId for ${path}`);
		}

		const operationId = `CORS_${key}`;
		handler.options = generateOptionsTemplate({
			allowedOrigins,
			operationId,
		});

		openApiSpec.paths[path] = handler;
	}

	return openApiSpec;
}

function generateOptionsTemplate({
	operationId,
	allowedOrigins,
}: {
	operationId: string;
	allowedOrigins: string[];
}) {
	return {
		operationId,
		security: [],
		responses: {
			"204": {
				description: "204 response",
				headers: {
					"Access-Control-Allow-Origin": {
						schema: { type: "string" },
					},
					"Access-Control-Allow-Methods": {
						schema: { type: "string" },
					},
					Vary: { schema: { type: "string" } },
					"Access-Control-Allow-Headers": {
						schema: { type: "string" },
					},
				},
				content: {},
			},
		},
		"x-amazon-apigateway-integration": {
			type: "mock",
			responses: {
				default: {
					statusCode: "204",
					responseParameters: {
						"method.response.header.Access-Control-Allow-Methods":
							"'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
						"method.response.header.Access-Control-Allow-Headers":
							"'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent,X-Resource-Path,X-HTTP-Method'",
						"method.response.header.Access-Control-Allow-Origin": "'*'",
						"method.response.header.Vary": "'Origin'",
					},
					responseTemplates: generateResponseTemplate(allowedOrigins),
				},
			},
			requestTemplates: { "application/json": "{ statusCode: 200 }" },
			passthroughBehavior: "when_no_match",
		},
	};
}

function generateResponseTemplate(allowedOrigins: string[]) {
	const lines: string[] = [];

	for (const domain of allowedOrigins) {
		lines.push(`#if($input.params().header.get("Origin") == "${domain}")`);
		lines.push(
			`	#set($context.responseOverride.header.Access-Control-Allow-Origin = "${domain}")`,
		);
		lines.push("#end");
	}

	return {
		"application/json": lines.join("\n"),
	};
}
