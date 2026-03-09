import { execSync } from "node:child_process";
import { composeArgs, resolveProject } from "../project.ts";

export async function stop(args: string[]): Promise<void> {
	const configFile = args[0];
	const ctx = resolveProject(configFile);

	const podmanArgs = composeArgs(ctx, ["down"]);

	process.stdout.write(`Stopping rockpool (${ctx.configFileName})...\n`);
	execSync(`podman ${podmanArgs.join(" ")}`, {
		cwd: ctx.projectRoot,
		stdio: "inherit",
	});

	process.stdout.write("Rockpool stopped.\n");
}
