import { RemovalPolicy } from "aws-cdk-lib";
import {
	OAuthScope,
	UserPool,
	UserPoolClient,
	UserPoolClientIdentityProvider,
} from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

export interface BookstoreUserPoolProps {
	stageName: string;
	userPoolName: string;
	cognitoDomainPrefix: string;
	callbackUrls: string[];
	logoutUrls: string[];
}

export class BookstoreUserPool extends Construct {
	public readonly userPool: UserPool;
	public readonly webClient: UserPoolClient;

	constructor(scope: Construct, id: string, props: BookstoreUserPoolProps) {
		super(scope, id);

		const { userPoolName, cognitoDomainPrefix, callbackUrls, logoutUrls } = props;

		this.userPool = new UserPool(this, "UserPool", {
			userPoolName,
			selfSignUpEnabled: true,
			signInAliases: { email: true },
			autoVerify: { email: true },
			removalPolicy: RemovalPolicy.DESTROY,
		});

		this.userPool.addDomain("CognitoDomain", {
			cognitoDomain: {
				domainPrefix: cognitoDomainPrefix,
			},
		});

		this.webClient = this.userPool.addClient("WebClient", {
			userPoolClientName: "webClient",
			oAuth: {
				flows: { authorizationCodeGrant: true },
				scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
				callbackUrls,
				logoutUrls,
			},
			supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
		});
	}
}
