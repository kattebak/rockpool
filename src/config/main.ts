export interface StageConfig {
	stageName: string;
	account: string;
	region: string;
	callbackUrls?: string[];
	logoutUrls?: string[];
	allowedOrigins?: string[];
}

export interface Config {
	aws: {
		region: string;
	};
	stages: StageConfig[];
}

const config: Config = {
	aws: {
		region: "eu-central-1",
	},
	stages: [],
};

export default config;
