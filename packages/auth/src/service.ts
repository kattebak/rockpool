import { request } from "@octokit/request";
import { createSession, createSessionStore } from "./session.ts";
import type { AuthConfig, GitHubUser, Session } from "./types.ts";
import { parseGitHubUser } from "./types.ts";

export interface AuthService {
	getAuthorizationUrl(state: string): string;
	exchangeCodeForToken(code: string): Promise<string>;
	getGitHubUser(accessToken: string): Promise<GitHubUser>;
	createSession(accessToken: string, user: GitHubUser): Promise<Session>;
	getSession(sessionId: string): Promise<Session | null>;
	deleteSession(sessionId: string): Promise<void>;
	config: AuthConfig;
}

interface OAuthTokenSuccess {
	accessToken: string;
}

interface OAuthTokenError {
	error: string;
	errorDescription: string;
}

type OAuthTokenResult = OAuthTokenSuccess | OAuthTokenError;

function parseOAuthTokenResponse(value: unknown): OAuthTokenResult {
	if (typeof value !== "object" || value === null) {
		throw new Error("Unexpected GitHub OAuth token response");
	}
	const obj = value as Record<string, unknown>;
	if (typeof obj.error === "string") {
		return {
			error: obj.error,
			errorDescription:
				typeof obj.error_description === "string" ? obj.error_description : obj.error,
		};
	}
	if (typeof obj.access_token === "string") {
		return { accessToken: obj.access_token };
	}
	throw new Error("Unexpected GitHub OAuth token response");
}

export function createAuthService(config: AuthConfig): AuthService {
	const sessionStore = createSessionStore();

	return {
		config,

		getAuthorizationUrl(state: string): string {
			const params = new URLSearchParams();
			params.set("client_id", config.clientId);
			params.set("redirect_uri", config.callbackUrl);
			params.set("scope", config.scopes.join(" "));
			params.set("state", state);
			return `https://github.com/login/oauth/authorize?${params}`;
		},

		async exchangeCodeForToken(code: string): Promise<string> {
			const response = await request("POST https://github.com/login/oauth/access_token", {
				client_id: config.clientId,
				client_secret: config.clientSecret,
				code,
			});

			const result = parseOAuthTokenResponse(response.data);
			if ("error" in result) {
				throw new Error(`GitHub OAuth error: ${result.errorDescription}`);
			}

			return result.accessToken;
		},

		async getGitHubUser(accessToken: string): Promise<GitHubUser> {
			const response = await request("GET /user", {
				headers: {
					authorization: `Bearer ${accessToken}`,
				},
			});

			return parseGitHubUser(response.data);
		},

		async createSession(accessToken: string, user: GitHubUser): Promise<Session> {
			const session = createSession(user.id, user.login, accessToken, config.sessionMaxAgeMs);
			await sessionStore.set(session);
			return session;
		},

		async getSession(sessionId: string): Promise<Session | null> {
			return sessionStore.get(sessionId);
		},

		async deleteSession(sessionId: string): Promise<void> {
			await sessionStore.delete(sessionId);
		},
	};
}
