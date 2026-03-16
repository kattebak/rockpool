import { execSync } from "node:child_process";
import { composeArgs, resolveComposeProvider, resolveProject } from "../project.ts";

export async function stop(args: string[]): Promise<void> {
	const provider = resolveComposeProvider();
	const configFile = args[0];
	const ctx = resolveProject(configFile);

	const providerArgs = composeArgs(ctx, ["down"]);

	process.stdout.write(`Stopping rockpool (${ctx.configFileName})...\n`);
	execSync(`${provider} ${providerArgs.join(" ")}`, {
		cwd: ctx.projectRoot,
		stdio: "inherit",
	});

	process.stdout.write("Rockpool stopped.\n");
}
