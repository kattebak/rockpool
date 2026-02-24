import { request } from "@octokit/request";
import { createSession, createSessionStore } from "./session.ts";
import type { AuthConfig, GitHubUser, Session } from "./types.ts";
import { parseGitHubUser } from "./types.ts";

export interface TokenResult {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	refreshTokenExpiresIn: number;
}

export interface AuthService {
	getAuthorizationUrl(state: string): string;
	exchangeCodeForToken(code: string): Promise<TokenResult>;
	refreshAccessToken(refreshToken: string): Promise<TokenResult>;
	getGitHubUser(accessToken: string): Promise<GitHubUser>;
	createSession(tokenResult: TokenResult, user: GitHubUser): Promise<Session>;
	getSession(sessionId: string): Promise<Session | null>;
	updateSessionTokens(sessionId: string, tokenResult: TokenResult): Promise<Session | null>;
	deleteSession(sessionId: string): Promise<void>;
	config: AuthConfig;
}

interface OAuthTokenSuccess {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	refreshTokenExpiresIn: number;
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
	if (typeof obj.access_token !== "string") {
		throw new Error("Unexpected GitHub OAuth token response: missing access_token");
	}
	if (typeof obj.refresh_token !== "string") {
		throw new Error("Unexpected GitHub OAuth token response: missing refresh_token");
	}
	return {
		accessToken: obj.access_token,
		refreshToken: obj.refresh_token,
		expiresIn: typeof obj.expires_in === "number" ? obj.expires_in : 0,
		refreshTokenExpiresIn:
			typeof obj.refresh_token_expires_in === "number" ? obj.refresh_token_expires_in : 0,
	};
}

export function createAuthService(config: AuthConfig): AuthService {
	const sessionStore = createSessionStore();

	return {
		config,

		getAuthorizationUrl(state: string): string {
			const params = new URLSearchParams();
			params.set("client_id", config.clientId);
			params.set("redirect_uri", config.callbackUrl);
			params.set("state", state);
			return `https://github.com/login/oauth/authorize?${params}`;
		},

		async exchangeCodeForToken(code: string): Promise<TokenResult> {
			const response = await request("POST https://github.com/login/oauth/access_token", {
				client_id: config.clientId,
				client_secret: config.clientSecret,
				code,
			});

			const result = parseOAuthTokenResponse(response.data);
			if ("error" in result) {
				throw new Error(`GitHub OAuth error: ${result.errorDescription}`);
			}

			return {
				accessToken: result.accessToken,
				refreshToken: result.refreshToken,
				expiresIn: result.expiresIn,
				refreshTokenExpiresIn: result.refreshTokenExpiresIn,
			};
		},

		async refreshAccessToken(refreshToken: string): Promise<TokenResult> {
			const response = await request("POST https://github.com/login/oauth/access_token", {
				client_id: config.clientId,
				client_secret: config.clientSecret,
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			});

			const result = parseOAuthTokenResponse(response.data);
			if ("error" in result) {
				throw new Error(`GitHub token refresh error: ${result.errorDescription}`);
			}

			return {
				accessToken: result.accessToken,
				refreshToken: result.refreshToken,
				expiresIn: result.expiresIn,
				refreshTokenExpiresIn: result.refreshTokenExpiresIn,
			};
		},

		async getGitHubUser(accessToken: string): Promise<GitHubUser> {
			const response = await request("GET /user", {
				headers: {
					authorization: `Bearer ${accessToken}`,
				},
			});

			return parseGitHubUser(response.data);
		},

		async createSession(tokenResult: TokenResult, user: GitHubUser): Promise<Session> {
			const tokenExpiresAt = Date.now() + tokenResult.expiresIn * 1000;
			const session = createSession(
				user.id,
				user.login,
				tokenResult.accessToken,
				tokenResult.refreshToken,
				tokenExpiresAt,
				config.sessionMaxAgeMs,
			);
			await sessionStore.set(session);
			return session;
		},

		async getSession(sessionId: string): Promise<Session | null> {
			return sessionStore.get(sessionId);
		},

		async updateSessionTokens(
			sessionId: string,
			tokenResult: TokenResult,
		): Promise<Session | null> {
			const session = await sessionStore.get(sessionId);
			if (!session) {
				return null;
			}
			const updated: Session = {
				...session,
				githubAccessToken: tokenResult.accessToken,
				refreshToken: tokenResult.refreshToken,
				tokenExpiresAt: Date.now() + tokenResult.expiresIn * 1000,
			};
			await sessionStore.set(updated);
			return updated;
		},

		async deleteSession(sessionId: string): Promise<void> {
			await sessionStore.delete(sessionId);
		},
	};
}
