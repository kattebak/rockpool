interface FormatParams {
	username: string;
}

export const formatTableName = ({ username }: FormatParams) =>
	`${username}-bookstore`;

export const formatFunctionName = ({ username }: FormatParams) =>
	`${username}-bookstore-backend`;

export const formatBucketName = ({ username }: FormatParams) =>
	`${username}-bookstore-frontend`;

export const formatUserPoolName = ({ username }: FormatParams) =>
	`${username}-bookstore-users`;

export const formatApiName = ({ username }: FormatParams) =>
	`${username}-bookstore-api`;

export const formatCognitoDomainPrefix = ({ username }: FormatParams) =>
	`${username}-bookstore`;

export const formatStackName = ({ username }: FormatParams) =>
	`${username}-BookstoreStack`;

export const formatLogGroupName = ({ username }: FormatParams) =>
	`/aws/apigateway/${username}-bookstore-api`;
