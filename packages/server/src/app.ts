import { createRequire } from "node:module";
import express, { type NextFunction, type Request, type Response } from "express";
import * as OpenApiValidator from "express-openapi-validator";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { createPortRouter } from "./routes/ports.ts";
import { createWorkspaceRouter } from "./routes/workspaces.ts";
import type { createPortService } from "./services/port-service.ts";
import type { createWorkspaceService } from "./services/workspace-service.ts";

const require = createRequire(import.meta.url);
const apiSpec = require.resolve("@tdpl/openapi");

export interface AppDeps {
	workspaceService: ReturnType<typeof createWorkspaceService>;
	portService?: ReturnType<typeof createPortService>;
	logger?: pino.Logger;
}

export function createApp(deps: AppDeps) {
	const logger = deps.logger ?? pino({ level: "info" });
	const app = express();

	app.use(express.json());
	app.use(pinoHttp({ logger }));

	app.use(
		OpenApiValidator.middleware({
			apiSpec,
			validateRequests: true,
			validateResponses: false,
			ignorePaths: /^\/api\/health/,
		}),
	);

	const workspaceRouter = createWorkspaceRouter(deps.workspaceService);
	app.use("/api/workspaces", workspaceRouter);

	if (deps.portService) {
		const portRouter = createPortRouter(deps.portService);
		app.use("/api/workspaces/:id/ports", portRouter);
	}

	app.get("/api/health", (_req, res) => {
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
