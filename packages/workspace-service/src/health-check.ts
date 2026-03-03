import type { Logger } from "pino";

const HEALTH_POLL_INTERVAL_MS = 1000;
const HEALTH_POLL_MAX_ATTEMPTS = 60;

export type HealthCheckFn = (vmIp: string) => Promise<void>;

function fetchHealthCheck(url: string, timeoutMs: number): Promise<boolean> {
	return fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
		.then((res) => res.ok)
		.catch(() => false);
}

function toHealthUrl(vmIp: string): string {
	const host = vmIp.includes(":") ? vmIp : `${vmIp}:8080`;
	return `http://${host}/healthz`;
}

export function defaultHealthCheck(logger: Logger): HealthCheckFn {
	return async (vmIp: string): Promise<void> => {
		const url = toHealthUrl(vmIp);
		for (let attempt = 0; attempt < HEALTH_POLL_MAX_ATTEMPTS; attempt++) {
			const ok = await fetchHealthCheck(url, 5000);
			if (ok) {
				return;
			}
			logger.debug({ vmIp, attempt }, "Waiting for code-server");
			await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
		}
		throw new Error(`Timed out waiting for code-server at ${url}`);
	};
}
