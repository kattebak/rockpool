import assert from "node:assert";

import { Duration } from "aws-cdk-lib";
import {
	Architecture,
	Code,
	Function as Fn,
	type FunctionProps,
	LoggingFormat,
	Runtime,
	Tracing,
} from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";

interface NodeJSArmLambdaProps
	extends Pick<FunctionProps, "role" | "loggingFormat" | "onFailure"> {
	functionName?: string;
	handler: string;
	memorySize?: number;
	timeout?: Duration;
	code?: Code;
}

export class NodeJSArmLambdaFunction extends Fn {
	constructor(scope: Construct, id: string, props: NodeJSArmLambdaProps) {
		const { functionName, handler, memorySize, timeout, code } = props;

		assert(
			(functionName ?? "").length < 64,
			`Expected ${functionName} to be less then 64 characters long`,
		);

		super(scope, id, {
			...props,
			memorySize: memorySize ?? 2048,
			runtime: Runtime.NODEJS_22_X,
			architecture: Architecture.ARM_64,
			timeout: timeout ?? Duration.seconds(10),
			handler,
			loggingFormat: LoggingFormat.JSON,
			functionName,
			tracing: Tracing.ACTIVE,
			code:
				code ??
				Code.fromInline(`exports.handler = async (event, context) => {
                    console.error({event, context, level: 50, message: "No code provided", timestamp: new Date().toISOString()});
                    throw new Error("No code provided");

            }`),
		});

		this.addEnvironment("NODE_OPTIONS", "--enable-source-maps");
		this.addEnvironment("NODE_ENV", "production");
		this.addEnvironment("AWS_NODEJS_CONNECTION_REUSE_ENABLED", "1");
	}
}
