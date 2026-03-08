import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RockpoolConfig } from "@rockpool/config";

export function needsClientBuild(config: RockpoolConfig, projectRoot: string): boolean {
	if (config.spa.proxyUrl) return false;

	const distDir = join(projectRoot, "packages/client/dist");
	const srcDir = join(projectRoot, "packages/client/src");

	if (!existsSync(distDir)) return true;

	const distMtime = statSync(distDir).mtimeMs;
	const srcMtime = statSync(srcDir).mtimeMs;

	return srcMtime > distMtime;
}
