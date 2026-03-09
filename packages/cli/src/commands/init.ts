import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { RockpoolConfigSchema } from "@rockpool/config";
import { REPO_ROOT } from "../project.ts";

interface InitFlags {
	authMode?: string;
	authUsername?: string;
	authPassword?: string;
	portHttp?: number;
	portIde?: number;
	portPreview?: number;
	logLevel?: string;
	runtime?: string;
	spaProxyUrl?: string;
	output?: string;
}

function parseInitFlags(args: string[]): InitFlags {
	const { values } = parseArgs({
		args,
		options: {
			"auth-mode": { type: "string" },
			"auth-username": { type: "string" },
			"auth-password": { type: "string" },
			"port-http": { type: "string" },
			"port-ide": { type: "string" },
			"port-preview": { type: "string" },
			"log-level": { type: "string" },
			runtime: { type: "string" },
			"spa-proxy-url": { type: "string" },
			o: { type: "string", short: "o" },
		},
		strict: true,
	});

	return {
		authMode: values["auth-mode"] as string | undefined,
		authUsername: values["auth-username"] as string | undefined,
		authPassword: values["auth-password"] as string | undefined,
		portHttp: values["port-http"] ? Number(values["port-http"]) : undefined,
		portIde: values["port-ide"] ? Number(values["port-ide"]) : undefined,
		portPreview: values["port-preview"] ? Number(values["port-preview"]) : undefined,
		logLevel: values["log-level"] as string | undefined,
		runtime: values.runtime as string | undefined,
		spaProxyUrl: values["spa-proxy-url"] as string | undefined,
		output: values.o as string | undefined,
	};
}

function isInteractive(): boolean {
	return process.stdin.isTTY === true;
}

async function promptIfMissing(
	rl: ReturnType<typeof createInterface> | null,
	value: string | undefined,
	question: string,
	defaultValue?: string,
): Promise<string> {
	if (value !== undefined) return value;
	if (!rl) {
		if (defaultValue !== undefined) return defaultValue;
		throw new Error(`Missing required value: ${question}`);
	}

	const suffix = defaultValue ? ` [${defaultValue}]` : "";
	const answer = await rl.question(`${question}${suffix}: `);
	return answer.trim() || defaultValue || "";
}

function buildConfig(params: {
	authMode: string;
	authUsername?: string;
	authPassword?: string;
	portHttp: number;
	portIde: number;
	portPreview: number;
	logLevel: string;
	runtime: string;
	spaProxyUrl: string;
}): Record<string, unknown> {
	const config: Record<string, unknown> = {
		$schema: "./packages/config/rockpool.schema.json",
		logLevel: params.logLevel,
		runtime: params.runtime,
		auth: {
			mode: params.authMode,
			...(params.authMode === "basic" && params.authUsername && params.authPassword
				? { basic: { username: params.authUsername, password: params.authPassword } }
				: {}),
		},
		ports: {
			http: params.portHttp,
			ide: params.portIde,
			preview: params.portPreview,
		},
	};

	if (params.spaProxyUrl) {
		config.spa = { proxyUrl: params.spaProxyUrl };
	}

	return config;
}

export async function init(args: string[]): Promise<void> {
	const flags = parseInitFlags(args);

	const hasAllRequired =
		flags.authMode !== undefined &&
		flags.authUsername !== undefined &&
		flags.authPassword !== undefined;

	let rl: ReturnType<typeof createInterface> | null = null;

	if (!hasAllRequired && isInteractive()) {
		rl = createInterface({ input: process.stdin, output: process.stdout });
	}

	const authMode = await promptIfMissing(
		rl,
		flags.authMode,
		"Authentication mode (basic / github)",
		"basic",
	);
	const authUsername =
		authMode === "basic" ? await promptIfMissing(rl, flags.authUsername, "Username") : undefined;
	const authPassword =
		authMode === "basic" ? await promptIfMissing(rl, flags.authPassword, "Password") : undefined;
	const portHttp =
		flags.portHttp ?? Number(await promptIfMissing(rl, undefined, "HTTP port", "8080"));
	const portIde = flags.portIde ?? Number(await promptIfMissing(rl, undefined, "IDE port", "8081"));
	const portPreview =
		flags.portPreview ?? Number(await promptIfMissing(rl, undefined, "Preview port", "8082"));
	const logLevel = await promptIfMissing(rl, flags.logLevel, "Log level", "info");
	const runtime = await promptIfMissing(rl, flags.runtime, "Runtime (podman / stub)", "podman");
	const spaProxyUrl = await promptIfMissing(
		rl,
		flags.spaProxyUrl,
		"SPA proxy URL (leave empty for static)",
		"",
	);

	rl?.close();

	const config = buildConfig({
		authMode,
		authUsername,
		authPassword,
		portHttp,
		portIde,
		portPreview,
		logLevel,
		runtime,
		spaProxyUrl,
	});

	const stripped = { ...config };
	delete stripped.$schema;
	RockpoolConfigSchema.parse(stripped);

	const outputFile = flags.output ?? "rockpool.config.json";
	const outputPath = resolve(REPO_ROOT, outputFile);
	writeFileSync(outputPath, `${JSON.stringify(config, null, "\t")}\n`);

	process.stdout.write(`Created ${outputFile}\n`);
}
