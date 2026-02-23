import type { CaddyRepository } from "@rockpool/caddy";
import type { DbClient, Port, Workspace } from "@rockpool/db";
import { addPort, getWorkspace, listPorts, removePort } from "@rockpool/db";
import { WorkspaceStatus as WS } from "@rockpool/enums";
import { ConflictError, NotFoundError } from "./workspace-service.ts";

const MAX_PORTS_PER_WORKSPACE = 5;

export interface PortServiceDeps {
	db: DbClient;
	caddy: CaddyRepository;
}

export function createPortService(deps: PortServiceDeps) {
	const { db, caddy } = deps;

	async function requireRunningWorkspace(id: string): Promise<Workspace> {
		const workspace = await getWorkspace(db, id);
		if (!workspace) {
			throw new NotFoundError(`Workspace "${id}" not found`);
		}
		if (workspace.status !== WS.running) {
			throw new ConflictError(
				`Ports can only be managed when workspace is running (current: "${workspace.status}")`,
			);
		}
		return workspace;
	}

	return {
		async list(workspaceId: string): Promise<Port[]> {
			const workspace = await getWorkspace(db, workspaceId);
			if (!workspace) {
				throw new NotFoundError(`Workspace "${workspaceId}" not found`);
			}
			return listPorts(db, workspaceId);
		},

		async add(workspaceId: string, port: number, label?: string): Promise<Port> {
			const workspace = await requireRunningWorkspace(workspaceId);

			const existing = await listPorts(db, workspaceId);
			if (existing.length >= MAX_PORTS_PER_WORKSPACE) {
				throw new ConflictError(
					`Maximum of ${MAX_PORTS_PER_WORKSPACE} ports per workspace reached`,
				);
			}
			if (existing.some((p) => p.port === port)) {
				throw new ConflictError(`Port ${port} is already registered for this workspace`);
			}

			const created = await addPort(db, { workspaceId, port, label });
			const vmIp = workspace.vmIp as string;
			await caddy.addPortRoute(workspace.name, vmIp, port);
			return created;
		},

		async remove(workspaceId: string, port: number): Promise<void> {
			const workspace = await requireRunningWorkspace(workspaceId);

			const existing = await listPorts(db, workspaceId);
			if (!existing.some((p) => p.port === port)) {
				throw new NotFoundError(`Port ${port} is not registered for this workspace`);
			}

			await removePort(db, workspaceId, port);
			await caddy.removePortRoute(workspace.name, port);
		},
	};
}
