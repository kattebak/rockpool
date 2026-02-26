import type { DbClient, UserPrefsFileName } from "@rockpool/db";
import {
	getAllUserPrefsBlobs,
	getUserPrefsBlob,
	getWorkspace,
	upsertUserPrefsBlob,
} from "@rockpool/db";
import { PREFS_FILE_PATHS, type RuntimeRepository } from "@rockpool/runtime";
import { Router } from "express";

export interface SettingsRouterDeps {
	db: DbClient;
	runtime: RuntimeRepository;
}

export function createSettingsRouter(deps: SettingsRouterDeps): Router {
	const { db, runtime } = deps;
	const router = Router();

	router.get("/", async (_req, res, next) => {
		try {
			const blobs = await getAllUserPrefsBlobs(db);
			res.json(blobs);
		} catch (err) {
			next(err);
		}
	});

	router.get("/:name", async (req, res, next) => {
		try {
			const name = req.params.name as UserPrefsFileName;
			const blob = await getUserPrefsBlob(db, name);
			if (!blob) {
				res.status(404).json({
					error: { code: "not_found", message: `Preference "${name}" not found` },
				});
				return;
			}
			res.json(blob);
		} catch (err) {
			next(err);
		}
	});

	router.put("/:name", async (req, res, next) => {
		try {
			const name = req.params.name as UserPrefsFileName;
			const workspaceId = req.query.workspaceId as string;

			const filePath = PREFS_FILE_PATHS[name];
			if (!filePath) {
				res.status(400).json({
					error: { code: "validation_error", message: `Invalid preference name "${name}"` },
				});
				return;
			}

			const workspace = await getWorkspace(db, workspaceId);
			if (!workspace) {
				res.status(404).json({
					error: { code: "not_found", message: `Workspace "${workspaceId}" not found` },
				});
				return;
			}

			if (workspace.status !== "running" || !workspace.vmIp) {
				res.status(409).json({
					error: {
						code: "conflict",
						message: `Workspace "${workspaceId}" is not running`,
					},
				});
				return;
			}

			if (!runtime.readFile) {
				res.status(502).json({
					error: {
						code: "internal_error",
						message: "Runtime does not support file operations",
					},
				});
				return;
			}

			let content: string;
			try {
				content = await runtime.readFile(workspace.name, workspace.vmIp, filePath);
			} catch {
				res.status(404).json({
					error: {
						code: "not_found",
						message: `File "${filePath}" not found in workspace`,
					},
				});
				return;
			}
			const blob = await upsertUserPrefsBlob(db, { name, blob: content });
			res.json(blob);
		} catch (err) {
			next(err);
		}
	});

	return router;
}
