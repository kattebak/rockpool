import spec from "@bookstore/openapi3";
import addFormats from "ajv-formats";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import OpenAPIBackend, { type Document } from "openapi-backend";
import { handleError } from "./error.js";
import { handlers } from "./handlers/index.js";
import { logger, withRequest } from "./logger.js";
import { normalizeRequest } from "./request.js";
import { postResponseHandler } from "./response.js";

const { OpenAPISpec } = spec;

const api = new OpenAPIBackend({
	definition: OpenAPISpec as unknown as Document,
	customizeAjv: (ajv) => {
		addFormats(ajv, { mode: "fast", formats: ["date-time", "email", "uri"] });
		return ajv;
	},
	quick: true,
});

api.register("postResponseHandler", postResponseHandler);

api.register("validationFail", (c, req) => {
	const operation = api.router.getOperation(c.operation?.operationId || "");
	logger.error(
		{
			errors: c.validation.errors,
			method: req.method,
			path: req.path,
			operation: c.operation?.operationId,
			operationParameters: operation?.parameters,
			validationContext: {
				parsedRequest: c.request,
				validationTarget: c.validation,
			},
		},
		"Validation failed",
	);
	return {
		statusCode: 400,
		body: {
			message: "Invalid request",
			errors: c.validation.errors,
		},
	};
});

api.register("notFound", () => ({ statusCode: 404 }));

api.register("notImplemented", async (c) => {
	const { status, mock } = api.mockResponseForOperation(
		c.operation.operationId as string,
	);
	return {
		statusCode: status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		},
		body: JSON.stringify(mock),
	};
});

api.register(handlers);

api.init();

export async function handler(event: APIGatewayProxyEvent, context: Context) {
	withRequest(event, context);

	logger.info(
		{ method: event.httpMethod, path: event.path },
		"Request received",
	);

	return api
		.handleRequest(normalizeRequest(event), event, context)
		.catch(handleError);
}
