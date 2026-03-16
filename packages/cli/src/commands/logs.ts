import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import { composeArgs, resolveComposeProvider, resolveProject } from "../project.ts";

export async function logs(args: string[]): Promise<void> {
	const provider = resolveComposeProvider();
	const { positionals, values } = parseArgs({
		args,
		options: {
			"no-follow": { type: "boolean", default: false },
			tail: { type: "string" },
		},
		allowPositionals: true,
		strict: false,
	});

	const configFile = positionals[0];
	const ctx = resolveProject(configFile);

	const logsArgs = ["logs"];
	if (!values["no-follow"]) {
		logsArgs.push("-f");
	}
	if (values.tail) {
		logsArgs.push(`--tail=${values.tail}`);
	}

	const providerArgs = composeArgs(ctx, logsArgs);

	execSync(`${provider} ${providerArgs.join(" ")}`, {
		cwd: ctx.projectRoot,
		stdio: "inherit",
	});
}
