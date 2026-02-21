import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import pino from "pino";
import { lambdaRequestTracker, pinoLambdaDestination } from "pino-lambda";

const loggerFormatters = {
	level: (label: string) => ({ level: label.toUpperCase() }),
};

const getLogger = () => {
	if (process.env.NODE_ENV === "development") {
		return pino({
			level: "debug",
			transport: {
				target: "pino-pretty",
				options: {
					singleLine: true,
					colorize: true,
				},
			},
		});
	}

	const destination = pinoLambdaDestination();
	return pino({ formatters: loggerFormatters }, destination);
};

export const logger = getLogger();

const pinoLambdaTracker = lambdaRequestTracker();

export const withRequest = (event: APIGatewayProxyEvent, context: Context) => {
	pinoLambdaTracker(event, context);
};
