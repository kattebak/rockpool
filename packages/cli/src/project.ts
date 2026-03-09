import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadConfig, type RockpoolConfig } from "@rockpool/config";
import { generateCompose } from "./compose.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

function deriveProjectName(configFileName: string): string {
	const name = basename(configFileName, ".json")
		.replace(/\.config$/, "")
		.replace(/\./g, "-");
	return name;
}

function detectPodmanSocket(): string | undefined {
	const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
	if (process.platform === "linux" && xdgRuntimeDir) {
		return `${xdgRuntimeDir}/podman/podman.sock`;
	}
	return undefined;
}

interface ProjectContext {
	config: RockpoolConfig;
	configFileName: string;
	projectRoot: string;
	composeFilePath: string;
	projectName: string;
}

export function resolveProject(configFileArg?: string): ProjectContext {
	const configFileName = configFileArg ?? "rockpool.config.json";
	const projectRoot = REPO_ROOT;
	const configPath = resolve(process.cwd(), configFileName);
	const config = loadConfig(configPath);

	const dotRockpool = resolve(projectRoot, ".rockpool");
	if (!existsSync(dotRockpool)) {
		mkdirSync(dotRockpool, { recursive: true });
	}

	const projectName = deriveProjectName(configFileName);
	const composeFilePath = resolve(dotRockpool, `compose.${projectName}.yaml`);

	const podmanSocket = detectPodmanSocket();
	const yaml = generateCompose({
		config,
		projectRoot,
		configFileName,
		configPath,
		podmanSocket,
	});
	writeFileSync(composeFilePath, yaml);

	return {
		config,
		configFileName,
		projectRoot,
		composeFilePath,
		projectName,
	};
}

export function composeArgs(ctx: ProjectContext, subcommand: string[]): string[] {
	return ["compose", "-f", ctx.composeFilePath, "-p", ctx.projectName, ...subcommand];
}

export { REPO_ROOT };
