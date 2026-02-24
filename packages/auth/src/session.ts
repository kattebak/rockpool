import type { Session } from "./types.ts";

export interface SessionStore {
	get(sessionId: string): Promise<Session | null>;
	set(session: Session): Promise<void>;
	delete(sessionId: string): Promise<void>;
	cleanup(): Promise<void>;
}

function generateSessionId(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createSessionStore(): SessionStore {
	const sessions = new Map<string, Session>();

	return {
		async get(sessionId: string): Promise<Session | null> {
			const session = sessions.get(sessionId);
			if (!session) {
				return null;
			}

			if (Date.now() > session.expiresAt) {
				sessions.delete(sessionId);
				return null;
			}

			return session;
		},

		async set(session: Session): Promise<void> {
			sessions.set(session.id, session);
		},

		async delete(sessionId: string): Promise<void> {
			sessions.delete(sessionId);
		},

		async cleanup(): Promise<void> {
			const now = Date.now();
			for (const [id, session] of sessions.entries()) {
				if (now > session.expiresAt) {
					sessions.delete(id);
				}
			}
		},
	};
}

export function createSession(
	userId: number,
	username: string,
	githubAccessToken: string,
	sessionMaxAgeMs: number,
): Session {
	const now = Date.now();
	return {
		id: generateSessionId(),
		userId,
		username,
		githubAccessToken,
		createdAt: now,
		expiresAt: now + sessionMaxAgeMs,
	};
}
