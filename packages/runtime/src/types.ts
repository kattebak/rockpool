export type VmStatus = "running" | "stopped" | "not_found";

export interface RuntimeRepository {
	create(name: string, image: string): Promise<void>;
	start(name: string): Promise<void>;
	stop(name: string): Promise<void>;
	remove(name: string): Promise<void>;
	status(name: string): Promise<VmStatus>;
	getIp(name: string): Promise<string>;
}
