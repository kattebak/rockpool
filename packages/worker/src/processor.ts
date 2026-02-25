import type { WorkspaceJob } from "@rockpool/queue";
import type { WorkspaceService } from "@rockpool/workspace-service";
import type { Logger } from "pino";

export interface ProcessorDeps {
	workspaceService: WorkspaceService;
	logger: Logger;
}

export function createProcessor(deps: ProcessorDeps) {
	const { workspaceService, logger } = deps;

	return {
		async process(job: WorkspaceJob): Promise<void> {
			logger.info({ workspaceId: job.workspaceId, jobType: job.type }, "Processing job");

			try {
				switch (job.type) {
					case "create":
					case "start":
						await workspaceService.provisionAndStart(job.workspaceId, {
							repository: job.repository,
							githubAccessToken: job.githubAccessToken,
						});
						break;
					case "stop":
						await workspaceService.teardown(job.workspaceId, "stop");
						break;
					case "delete":
						await workspaceService.teardown(job.workspaceId, "delete");
						break;
				}
			} catch (err) {
				logger.error(
					{ err, workspaceId: job.workspaceId, jobType: job.type },
					"Job processing failed",
				);
				await workspaceService.setError(
					job.workspaceId,
					err instanceof Error ? err.message : String(err),
				);
			}
		},
	};
}
