import {
	AccessLogFormat,
	ApiDefinition,
	LogGroupLogDestination,
	SpecRestApi,
} from "aws-cdk-lib/aws-apigateway";
import {
	Certificate,
	CertificateValidation,
} from "aws-cdk-lib/aws-certificatemanager";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import {
	ARecord,
	type IPublicHostedZone,
	RecordTarget,
} from "aws-cdk-lib/aws-route53";
import { ApiGateway } from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";
import { injectCorsOptionsHandlers } from "#lib/inject-cors-options.js";
import { ACCESS_LOG_FORMAT } from "./access-log-format.js";

interface APIGatewayOpenAPIProps {
	name: string;
	openApiSpec: string;
	handler: IFunction;
	templateVariables: Record<string, string>;
	allowedOrigins: string[];
	logRetentionDays?: RetentionDays;
}

export class APIGatewayOpenAPI extends Construct {
	readonly api: SpecRestApi;
	readonly restApiId: string;

	constructor(scope: Construct, id: string, props: APIGatewayOpenAPIProps) {
		super(scope, id);

		const {
			name,
			openApiSpec,
			templateVariables,
			handler,
			allowedOrigins,
			logRetentionDays = RetentionDays.ONE_MONTH,
		} = props;

		const transformedSpec = this.injectTemplateVariables({
			template: openApiSpec,
			templateVariables,
		});

		if (allowedOrigins.length > 0) {
			injectCorsOptionsHandlers({
				allowedOrigins,
				openApiSpec: transformedSpec,
			});
		}

		const accessLogGroup = new LogGroup(this, "AccessLogGroup", {
			logGroupName: `/aws/apigateway/${name}`,
			retention: logRetentionDays,
		});

		const specApi = new SpecRestApi(this, "SpecRestApi", {
			restApiName: name,
			apiDefinition: ApiDefinition.fromInline(transformedSpec),
			deploy: true,
			deployOptions: {
				tracingEnabled: true,
				accessLogDestination: new LogGroupLogDestination(accessLogGroup),
				accessLogFormat: AccessLogFormat.custom(ACCESS_LOG_FORMAT),
			},
		});

		handler.addPermission("PermitAPIGInvocation", {
			principal: new ServicePrincipal("apigateway.amazonaws.com"),
			sourceArn: specApi.arnForExecuteApi("*"),
		});

		this.api = specApi;
		this.restApiId = specApi.restApiId;
	}

	public addDomainName({
		domainName,
		hostedZone,
	}: {
		domainName: string;
		hostedZone: IPublicHostedZone;
	}) {
		const certificate = new Certificate(this, "ApiCertificate", {
			domainName,
			validation: CertificateValidation.fromDns(hostedZone),
		});

		this.api.addDomainName("CustomDomainName", {
			domainName,
			certificate,
		});

		new ARecord(this, "ApiDomainNameRecord", {
			recordName: domainName,
			target: RecordTarget.fromAlias(new ApiGateway(this.api)),
			zone: hostedZone,
		});
	}

	private injectTemplateVariables = ({
		template,
		templateVariables,
	}: {
		template: string;
		templateVariables: APIGatewayOpenAPIProps["templateVariables"];
	}) => {
		for (const [key, value] of Object.entries(templateVariables)) {
			template = template.replaceAll(`{{${key}}}`, value);
		}

		return JSON.parse(template);
	};
}
