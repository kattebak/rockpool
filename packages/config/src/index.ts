import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { z } from "zod";
import { RockpoolConfigSchema } from "./schema.ts";

export type RockpoolConfig = z.infer<typeof RockpoolConfigSchema>;
export { RockpoolConfigSchema } from "./schema.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

function resolveConfigPath(configPath?: string): string {
	if (configPath) {
		if (isAbsolute(configPath)) return configPath;
		return resolve(REPO_ROOT, configPath);
	}

	const envPath = process.env.ROCKPOOL_CONFIG;
	if (envPath) {
		if (isAbsolute(envPath)) return envPath;
		return resolve(REPO_ROOT, envPath);
	}

	throw new Error(
		"No config file specified. Set ROCKPOOL_CONFIG environment variable or pass a path to loadConfig().",
	);
}

export function loadConfig(configPath?: string): RockpoolConfig {
	const resolvedPath = resolveConfigPath(configPath);
	const raw = readFileSync(resolvedPath, "utf-8");
	const json: unknown = JSON.parse(raw);
	return RockpoolConfigSchema.parse(json);
}
