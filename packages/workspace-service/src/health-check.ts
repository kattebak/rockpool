import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "pino";

const HEALTH_POLL_INTERVAL_MS = 1000;
const HEALTH_POLL_MAX_ATTEMPTS = 60;

export type HealthCheckFn = (vmIp: string) => Promise<void>;

const execFileAsync = promisify(execFile);

function curlHealthCheck(url: string, timeoutSec: number): Promise<boolean> {
	return execFileAsync("curl", ["-sf", "--max-time", String(timeoutSec), "-o", "/dev/null", url])
		.then(() => true)
		.catch(() => false);
}

export function defaultHealthCheck(logger: Logger): HealthCheckFn {
	return async (vmIp: string): Promise<void> => {
		const url = `http://${vmIp}:8080/healthz`;
		for (let attempt = 0; attempt < HEALTH_POLL_MAX_ATTEMPTS; attempt++) {
			const ok = await curlHealthCheck(url, 5);
			if (ok) {
				return;
			}
			logger.debug({ vmIp, attempt }, "Waiting for code-server");
			await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
		}
		throw new Error(`Timed out waiting for code-server at ${url}`);
	};
}
