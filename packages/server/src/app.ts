import { createRequire } from "node:module";
import type { AuthService, Session } from "@rockpool/auth";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import * as OpenApiValidator from "express-openapi-validator";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { createPortRouter } from "./routes/ports.ts";
import { createWorkspaceRouter } from "./routes/workspaces.ts";
import type { createPortService } from "./services/port-service.ts";
import type { createWorkspaceService } from "./services/workspace-service.ts";

const require = createRequire(import.meta.url);
const apiSpec = require.resolve("@rockpool/openapi");

export interface AppDeps {
	workspaceService: ReturnType<typeof createWorkspaceService>;
	portService?: ReturnType<typeof createPortService>;
	logger?: pino.Logger;
	authService: AuthService | null;
	secureCookies?: boolean;
}

function parseCookies(req: Request): Record<string, string> {
	return (req.cookies ?? {}) as Record<string, string>;
}

export function createApp(deps: AppDeps) {
	const logger = deps.logger ?? pino({ level: "info" });
	const app = express();

	app.use(express.json());
	app.use(cookieParser());
	app.use(pinoHttp({ logger }));

	app.use(
		OpenApiValidator.middleware({
			apiSpec,
			validateRequests: true,
			validateResponses: false,
			ignorePaths: /^\/api\/(health|ping|auth)/,
		}),
	);

	if (deps.authService) {
		mountAuthRoutes(app, deps.authService, logger, deps.secureCookies ?? false);
	}

	const workspaceRouter = createWorkspaceRouter(deps.workspaceService);

	if (deps.authService) {
		const authService = deps.authService;
		app.use("/api/workspaces", requireSession(authService), workspaceRouter);
	} else {
		app.use("/api/workspaces", workspaceRouter);
	}

	if (deps.portService) {
		const portRouter = createPortRouter(deps.portService);
		if (deps.authService) {
			const authService = deps.authService;
			app.use("/api/workspaces/:id/ports", requireSession(authService), portRouter);
		} else {
			app.use("/api/workspaces/:id/ports", portRouter);
		}
	}

	app.get("/api/ping", (_req, res) => {
		res.json({ status: "ok" });
	});

	app.use(
		(
			err: Error & { statusCode?: number; status?: number; errors?: unknown[] },
			_req: Request,
			res: Response,
			_next: NextFunction,
		) => {
			const statusCode = err.status ?? err.statusCode ?? 500;

			if (statusCode >= 500) {
				logger.error(err, "Unhandled error");
			}

			if (err.errors) {
				res.status(statusCode).json({
					error: {
						code: "validation_error",
						message: err.message,
						fields: err.errors,
					},
				});
				return;
			}

			const code =
				statusCode === 400
					? "validation_error"
					: statusCode === 404
						? "not_found"
						: statusCode === 409
							? "conflict"
							: "internal_error";

			res.status(statusCode).json({
				error: {
					code,
					message: err.message,
				},
			});
		},
	);

	return app;
}

function mountAuthRoutes(
	app: express.Express,
	authService: AuthService,
	logger: pino.Logger,
	secureCookies: boolean,
): void {
	app.get("/api/auth/github", (req, res) => {
		const state = crypto.randomUUID();
		const returnTo = req.query.return_to;

		res.cookie("oauth_state", state, { httpOnly: true, secure: secureCookies, sameSite: "lax" });

		if (typeof returnTo === "string" && returnTo.length > 0) {
			res.cookie("oauth_return_to", returnTo, {
				httpOnly: true,
				secure: secureCookies,
				sameSite: "lax",
			});
		}

		const authUrl = authService.getAuthorizationUrl(state);
		res.redirect(authUrl);
	});

	app.get("/api/auth/callback", async (req, res) => {
		const { code, state, error, setup_action } = req.query;
		const cookies = parseCookies(req);

		if (typeof setup_action === "string") {
			res.redirect("/api/auth/github");
			return;
		}

		if (error) {
			logger.error({ error }, "OAuth error from GitHub");
			res.status(400).json({ error: "OAuth failed" });
			return;
		}

		if (!code || typeof code !== "string") {
			res.status(400).json({ error: "Missing authorization code" });
			return;
		}

		if (!state || typeof state !== "string") {
			res.status(400).json({ error: "Missing state parameter" });
			return;
		}

		if (state !== cookies.oauth_state) {
			res.status(400).json({ error: "Invalid state parameter" });
			return;
		}

		const tokenResult = await authService.exchangeCodeForToken(code);
		const githubUser = await authService.getGitHubUser(tokenResult.accessToken);
		const session = await authService.createSession(tokenResult, githubUser);

		const maxAgeSeconds = Math.floor(authService.config.sessionMaxAgeMs / 1000);

		res.cookie("session", session.id, {
			httpOnly: true,
			secure: secureCookies,
			sameSite: "lax",
			maxAge: maxAgeSeconds,
		});

		res.clearCookie("oauth_state");

		const returnTo = cookies.oauth_return_to;
		res.clearCookie("oauth_return_to");

		if (typeof returnTo === "string" && returnTo.length > 0) {
			res.redirect(returnTo);
			return;
		}

		res.redirect("/app/workspaces");
	});

	app.get("/api/auth/me", async (req, res) => {
		const cookies = parseCookies(req);
		const sessionId = cookies.session;

		if (!sessionId) {
			res.status(401).json({ error: "Not authenticated" });
			return;
		}

		const session = await authService.getSession(sessionId);
		if (!session) {
			res.status(401).json({ error: "Invalid session" });
			return;
		}

		res.json({
			user: {
				id: session.userId,
				username: session.username,
			},
		});
	});

	app.get("/api/auth/verify", async (req, res) => {
		const cookies = parseCookies(req);
		const sessionId = cookies.session;

		if (!sessionId) {
			res.status(401).send("");
			return;
		}

		const session = await authService.getSession(sessionId);
		if (!session) {
			res.status(401).send("");
			return;
		}

		res.set("X-Authenticated-User", session.username);
		res.status(200).send("");
	});

	app.post("/api/auth/logout", async (req, res) => {
		const cookies = parseCookies(req);
		const sessionId = cookies.session;

		if (sessionId) {
			await authService.deleteSession(sessionId);
		}

		res.clearCookie("session");
		res.json({ message: "Logged out" });
	});
}

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

function isTokenExpiringSoon(session: Session): boolean {
	return Date.now() + TOKEN_REFRESH_BUFFER_MS >= session.tokenExpiresAt;
}

function requireSession(
	authService: AuthService,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		if (req.path === "/api/health" || req.path.startsWith("/app/assets/")) {
			next();
			return;
		}

		const cookies = parseCookies(req);
		const sessionId = cookies.session;

		if (!sessionId) {
			res.status(401).json({ error: "Not authenticated" });
			return;
		}

		const session = await authService.getSession(sessionId);
		if (!session) {
			res.status(401).json({ error: "Invalid session" });
			return;
		}

		if (isTokenExpiringSoon(session)) {
			const tokenResult = await authService.refreshAccessToken(session.refreshToken);
			await authService.updateSessionTokens(sessionId, tokenResult);
		}

		next();
	};
}
