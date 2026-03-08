import type { CaddyRepository } from "./types.ts";

export function createStubCaddy(): CaddyRepository {
	return {
		async addWorkspaceRoute(_name: string, _containerIp: string): Promise<void> {},
		async removeWorkspaceRoute(_name: string): Promise<void> {},
		async addPortRoute(
			_workspaceName: string,
			_containerIp: string,
			_port: number,
		): Promise<void> {},
		async removePortRoute(_workspaceName: string, _port: number): Promise<void> {},
		async bootstrap(_config: unknown): Promise<void> {},
	};
}
