import { request } from "@octokit/request";
import type { Session } from "@rockpool/auth";
import { type NextFunction, type Request, type Response, Router } from "express";

interface GitHubRepo {
	full_name: string;
	owner: string;
	owner_type: "User" | "Organization";
	owner_avatar: string;
	description: string | null;
	private: boolean;
	default_branch: string;
	updated_at: string;
}

function parseNextPage(linkHeader: string | undefined): number | null {
	if (!linkHeader) return null;
	const match = linkHeader.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="next"/);
	if (!match) return null;
	return Number.parseInt(match[1], 10);
}

function mapGitHubRepo(repo: Record<string, unknown>): GitHubRepo {
	const owner = repo.owner as Record<string, unknown>;
	return {
		full_name: repo.full_name as string,
		owner: owner.login as string,
		owner_type: (owner.type as string) === "Organization" ? "Organization" : "User",
		owner_avatar: owner.avatar_url as string,
		description: (repo.description as string) ?? null,
		private: repo.private as boolean,
		default_branch: repo.default_branch as string,
		updated_at: repo.updated_at as string,
	};
}

interface OctokitError {
	status: number;
}

function handleGitHubError(err: OctokitError, res: Response): void {
	const status = err.status;

	if (status === 401) {
		res.status(401).json({ error: "GitHub session expired, please log in again" });
		return;
	}

	if (status === 403) {
		res.status(429).json({ error: "GitHub rate limit exceeded, try again later" });
		return;
	}

	if (status && status >= 500) {
		res.status(502).json({ error: "GitHub is unavailable" });
		return;
	}

	res.status(502).json({ error: "GitHub is unavailable" });
}

function getOptionalSession(res: Response): Session | undefined {
	return res.locals.session as Session | undefined;
}

function clampInt(raw: unknown, defaultVal: number, min: number, max: number): number {
	const n = Number(raw);
	if (Number.isNaN(n)) return defaultVal;
	return Math.max(min, Math.min(max, Math.floor(n)));
}

export function createGitHubRouter(): Router {
	const router = Router();

	router.get("/repos", async (req: Request, res: Response, next: NextFunction) => {
		const session = getOptionalSession(res);

		if (!session?.githubAccessToken) {
			res.json({ items: [], next_page: null });
			return;
		}

		const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
		const perPage = clampInt(req.query.per_page, 30, 1, 100);
		type SortField = "created" | "updated" | "pushed" | "full_name";
		const validSorts: SortField[] = ["created", "updated", "pushed", "full_name"];
		const sort: SortField = validSorts.includes(req.query.sort as SortField)
			? (req.query.sort as SortField)
			: "updated";

		try {
			const response = await request("GET /user/repos", {
				headers: {
					authorization: `Bearer ${session.githubAccessToken}`,
					"X-GitHub-Api-Version": "2022-11-28",
				},
				type: "all",
				sort,
				per_page: perPage,
				page,
			});

			const items = (response.data as Record<string, unknown>[]).map(mapGitHubRepo);
			const nextPage = parseNextPage(response.headers.link);

			res.json({ items, next_page: nextPage });
		} catch (err) {
			if ((err as OctokitError).status) {
				handleGitHubError(err as OctokitError, res);
				return;
			}
			next(err);
		}
	});

	router.get("/repos/search", async (req: Request, res: Response, next: NextFunction) => {
		const session = getOptionalSession(res);
		const q = req.query.q;

		if (!q || typeof q !== "string") {
			res.status(400).json({ error: "Search query is required" });
			return;
		}

		const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
		const perPage = clampInt(req.query.per_page, 30, 1, 100);

		const headers: Record<string, string> = { "X-GitHub-Api-Version": "2022-11-28" };
		if (session?.githubAccessToken) {
			headers.authorization = `Bearer ${session.githubAccessToken}`;
		}

		try {
			const response = await request("GET /search/repositories", {
				headers,
				q,
				per_page: perPage,
				page,
			});

			const data = response.data as Record<string, unknown>;
			const rawItems = data.items as Record<string, unknown>[];
			const items = rawItems.map(mapGitHubRepo);
			const nextPage = parseNextPage(response.headers.link);
			const totalCount = data.total_count as number;

			res.json({ items, total_count: totalCount, next_page: nextPage });
		} catch (err) {
			if ((err as OctokitError).status) {
				handleGitHubError(err as OctokitError, res);
				return;
			}
			next(err);
		}
	});

	return router;
}
