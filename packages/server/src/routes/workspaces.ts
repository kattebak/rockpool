import { Router } from "express";

type WorkspaceService = ReturnType<
	typeof import("../services/workspace-service.ts").createWorkspaceService
>;

export function createWorkspaceRouter(service: WorkspaceService): Router {
	const router = Router();

	router.get("/", async (_req, res, next) => {
		try {
			const workspaces = await service.list();
			res.json(workspaces);
		} catch (err) {
			next(err);
		}
	});

	router.post("/", async (req, res, next) => {
		try {
			const { name, image } = req.body;
			const workspace = await service.create(name, image);
			res.status(201).json(workspace);
		} catch (err) {
			next(err);
		}
	});

	router.get("/:id", async (req, res, next) => {
		try {
			const workspace = await service.get(req.params.id);
			if (!workspace) {
				res.status(404).json({
					error: { code: "not_found", message: "Workspace not found" },
				});
				return;
			}
			res.json(workspace);
		} catch (err) {
			next(err);
		}
	});

	router.delete("/:id", async (req, res, next) => {
		try {
			await service.remove(req.params.id);
			res.status(204).end();
		} catch (err) {
			next(err);
		}
	});

	router.post("/:id/start", async (req, res, next) => {
		try {
			const workspace = await service.start(req.params.id);
			res.json(workspace);
		} catch (err) {
			next(err);
		}
	});

	router.post("/:id/stop", async (req, res, next) => {
		try {
			const workspace = await service.stop(req.params.id);
			res.json(workspace);
		} catch (err) {
			next(err);
		}
	});

	return router;
}
