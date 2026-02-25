import { request } from "@octokit/request";
import type { Session } from "@rockpool/auth";
import type { DbClient } from "@rockpool/db";
import { linkWorkspaceRepository, upsertRepository } from "@rockpool/db";
import { Router } from "express";

type WorkspaceService = ReturnType<
	typeof import("../services/workspace-service.ts").createWorkspaceService
>;

interface WorkspaceRouterDeps {
	db: DbClient;
}

export function createWorkspaceRouter(
	service: WorkspaceService,
	deps: WorkspaceRouterDeps,
): Router {
	const router = Router();

	router.get("/", async (req, res, next) => {
		try {
			const rawLimit = Number(req.query.limit);
			const limit = Number.isNaN(rawLimit) ? 25 : Math.max(1, Math.min(100, rawLimit));
			const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
			const result = await service.list({ limit, cursor });
			res.json(result);
		} catch (err) {
			next(err);
		}
	});

	router.post("/", async (req, res, next) => {
		try {
			const { name, image, description, repositoryId } = req.body;
			let resolvedRepoId: string | undefined;
			let repoFullName: string | undefined;

			const session = res.locals.session as Session | undefined;

			if (repositoryId?.includes("/")) {
				const headers: Record<string, string> = {
					"X-GitHub-Api-Version": "2022-11-28",
				};
				if (session?.githubAccessToken) {
					headers.authorization = `Bearer ${session.githubAccessToken}`;
				}
				const response = await request("GET /repos/{owner}/{repo}", {
					headers,
					owner: repositoryId.split("/")[0],
					repo: repositoryId.split("/").slice(1).join("/"),
				});
				const ghRepo = response.data;
				const owner = ghRepo.owner;
				const record = await upsertRepository(deps.db, {
					full_name: ghRepo.full_name,
					owner: owner.login,
					owner_type: owner.type === "Organization" ? "Organization" : "User",
					owner_avatar: owner.avatar_url,
					description: ghRepo.description ?? null,
					default_branch: ghRepo.default_branch,
					private: ghRepo.private,
				});
				resolvedRepoId = record.id;
				repoFullName = ghRepo.full_name;
			} else if (repositoryId) {
				resolvedRepoId = repositoryId;
			}

			const workspace = await service.create(name, image, {
				description,
				repository: repoFullName,
				githubAccessToken: session?.githubAccessToken,
			});

			if (resolvedRepoId) {
				await linkWorkspaceRepository(deps.db, workspace.id, resolvedRepoId);
			}

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
