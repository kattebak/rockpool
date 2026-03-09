import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { needsClientBuild } from "../client-build.ts";
import { composeArgs, REPO_ROOT, resolveProject } from "../project.ts";

export async function run(args: string[]): Promise<void> {
	const configFile = args[0];
	const ctx = resolveProject(configFile);

	if (needsClientBuild(ctx.config, ctx.projectRoot)) {
		const configAbsPath = resolve(process.cwd(), ctx.configFileName);
		process.stdout.write("Building client...\n");
		execSync("npm run build -w packages/client", {
			cwd: REPO_ROOT,
			stdio: "inherit",
			env: {
				...process.env,
				ROCKPOOL_CONFIG: configAbsPath,
			},
		});
	}

	const podmanArgs = composeArgs(ctx, ["up", "-d"]);

	process.stdout.write(`Starting rockpool (${ctx.configFileName})...\n`);
	execSync(`podman ${podmanArgs.join(" ")}`, {
		cwd: ctx.projectRoot,
		stdio: "inherit",
	});

	process.stdout.write("Rockpool is running.\n");
}
