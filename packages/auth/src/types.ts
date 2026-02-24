export interface GitHubUser {
	id: number;
	login: string;
	name: string | null;
	email: string | null;
	avatarUrl: string;
}

export interface Session {
	id: string;
	userId: number;
	username: string;
	githubAccessToken: string;
	createdAt: number;
	expiresAt: number;
}

export interface AuthConfig {
	clientId: string;
	clientSecret: string;
	callbackUrl: string;
	scopes: string[];
	sessionMaxAgeMs: number;
}

export function parseGitHubUser(value: unknown): GitHubUser {
	if (typeof value !== "object" || value === null) {
		throw new Error("Unexpected GitHub /user response");
	}
	const obj = value as Record<string, unknown>;
	if (
		typeof obj.id !== "number" ||
		typeof obj.login !== "string" ||
		(typeof obj.name !== "string" && obj.name !== null) ||
		(typeof obj.email !== "string" && obj.email !== null) ||
		typeof obj.avatar_url !== "string"
	) {
		throw new Error("Unexpected GitHub /user response");
	}
	return {
		id: obj.id,
		login: obj.login,
		name: obj.name as string | null,
		email: obj.email as string | null,
		avatarUrl: obj.avatar_url,
	};
}
