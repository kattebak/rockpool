export { ConflictError, NotFoundError } from "./errors.ts";
export type { HealthCheckFn } from "./health-check.ts";
export { defaultHealthCheck } from "./health-check.ts";
export type { WorkspaceServiceDeps } from "./types.ts";
export type { TeardownMode } from "./workspace-service.ts";
export { createWorkspaceService } from "./workspace-service.ts";

import type { createWorkspaceService } from "./workspace-service.ts";
export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
