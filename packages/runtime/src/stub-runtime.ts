import type { RuntimeRepository, VmStatus } from "./types.ts";

interface StubVm {
	name: string;
	image: string;
	status: VmStatus;
}

export function createStubRuntime(): RuntimeRepository {
	const vms = new Map<string, StubVm>();
	let ipCounter = 1;

	return {
		async create(name: string, image: string): Promise<void> {
			if (vms.has(name)) {
				throw new Error(`VM "${name}" already exists`);
			}
			vms.set(name, { name, image, status: "stopped" });
		},

		async start(name: string): Promise<void> {
			const vm = vms.get(name);
			if (!vm) {
				throw new Error(`VM "${name}" not found`);
			}
			vm.status = "running";
		},

		async stop(name: string): Promise<void> {
			const vm = vms.get(name);
			if (!vm) {
				throw new Error(`VM "${name}" not found`);
			}
			vm.status = "stopped";
		},

		async remove(name: string): Promise<void> {
			vms.delete(name);
		},

		async status(name: string): Promise<VmStatus> {
			const vm = vms.get(name);
			if (!vm) {
				return "not_found";
			}
			return vm.status;
		},

		async getIp(name: string): Promise<string> {
			const vm = vms.get(name);
			if (!vm) {
				throw new Error(`VM "${name}" not found`);
			}
			return `10.0.1.${ipCounter++}`;
		},

		async clone(
			_name: string,
			_vmIp: string,
			_repository: string,
			_token?: string,
		): Promise<void> {},
	};
}
