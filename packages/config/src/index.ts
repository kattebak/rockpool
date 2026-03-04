import { readFileSync } from "node:fs";
import type { z } from "zod";
import { RockpoolConfigSchema } from "./schema.ts";

export type RockpoolConfig = z.infer<typeof RockpoolConfigSchema>;
export { RockpoolConfigSchema } from "./schema.ts";

function resolveConfigPath(configPath?: string): string {
	if (configPath) return configPath;

	const envPath = process.env.ROCKPOOL_CONFIG;
	if (envPath) return envPath;

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
