import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { RockpoolConfigSchema } from "@rockpool/config";

interface InitFlags {
	authMode?: string;
	authUsername?: string;
	authPassword?: string;
	authClientId?: string;
	authClientSecret?: string;
	authCallbackUrl?: string;
	portHttp?: number;
	portIde?: number;
	portPreview?: number;
	logLevel?: string;
	runtime?: string;
	spaProxyUrl?: string;
	tunnelDomain?: string;
	tunnelToken?: string;
	output?: string;
}

function parseInitFlags(args: string[]): InitFlags {
	const { values } = parseArgs({
		args,
		options: {
			"auth-mode": { type: "string" },
			"auth-username": { type: "string" },
			"auth-password": { type: "string" },
			"auth-client-id": { type: "string" },
			"auth-client-secret": { type: "string" },
			"auth-callback-url": { type: "string" },
			"port-http": { type: "string" },
			"port-ide": { type: "string" },
			"port-preview": { type: "string" },
			"log-level": { type: "string" },
			runtime: { type: "string" },
			"spa-proxy-url": { type: "string" },
			"tunnel-domain": { type: "string" },
			"tunnel-token": { type: "string" },
			o: { type: "string", short: "o" },
		},
		strict: true,
	});

	return {
		authMode: values["auth-mode"] as string | undefined,
		authUsername: values["auth-username"] as string | undefined,
		authPassword: values["auth-password"] as string | undefined,
		authClientId: values["auth-client-id"] as string | undefined,
		authClientSecret: values["auth-client-secret"] as string | undefined,
		authCallbackUrl: values["auth-callback-url"] as string | undefined,
		portHttp: values["port-http"] ? Number(values["port-http"]) : undefined,
		portIde: values["port-ide"] ? Number(values["port-ide"]) : undefined,
		portPreview: values["port-preview"] ? Number(values["port-preview"]) : undefined,
		logLevel: values["log-level"] as string | undefined,
		runtime: values.runtime as string | undefined,
		spaProxyUrl: values["spa-proxy-url"] as string | undefined,
		tunnelDomain: values["tunnel-domain"] as string | undefined,
		tunnelToken: values["tunnel-token"] as string | undefined,
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

function buildAuthBlock(params: {
	authMode: string;
	authUsername?: string;
	authPassword?: string;
	authClientId?: string;
	authClientSecret?: string;
	authCallbackUrl?: string;
}): Record<string, unknown> {
	const auth: Record<string, unknown> = { mode: params.authMode };

	if (params.authMode === "basic" && params.authUsername && params.authPassword) {
		auth.basic = { username: params.authUsername, password: params.authPassword };
	}

	if (params.authMode === "github" && params.authClientId && params.authClientSecret) {
		const github: Record<string, string> = {
			clientId: params.authClientId,
			clientSecret: params.authClientSecret,
		};
		if (params.authCallbackUrl) {
			github.callbackUrl = params.authCallbackUrl;
		}
		auth.github = github;
	}

	return auth;
}

function buildConfig(params: {
	authMode: string;
	authUsername?: string;
	authPassword?: string;
	authClientId?: string;
	authClientSecret?: string;
	authCallbackUrl?: string;
	portHttp: number;
	portIde: number;
	portPreview: number;
	logLevel: string;
	runtime: string;
	spaProxyUrl: string;
	tunnelDomain?: string;
	tunnelToken?: string;
}): Record<string, unknown> {
	const config: Record<string, unknown> = {
		$schema: "./packages/config/rockpool.schema.json",
		logLevel: params.logLevel,
		runtime: params.runtime,
		auth: buildAuthBlock(params),
		ports: {
			http: params.portHttp,
			ide: params.portIde,
			preview: params.portPreview,
		},
	};

	if (params.spaProxyUrl) {
		config.spa = { proxyUrl: params.spaProxyUrl };
	}

	if (params.tunnelDomain && params.tunnelToken) {
		config.tunnel = { domain: params.tunnelDomain, token: params.tunnelToken };
		config.urls = {
			ide: `https://ide.${params.tunnelDomain}`,
			preview: `https://preview.${params.tunnelDomain}`,
		};
		config.server = { secureCookies: true };
	}

	return config;
}

export async function init(args: string[]): Promise<void> {
	const flags = parseInitFlags(args);

	const hasAllBasic =
		flags.authMode === "basic" &&
		flags.authUsername !== undefined &&
		flags.authPassword !== undefined;

	const hasAllGitHub =
		flags.authMode === "github" &&
		flags.authClientId !== undefined &&
		flags.authClientSecret !== undefined;

	const hasAllRequired = hasAllBasic || hasAllGitHub;

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
	const authClientId =
		authMode === "github"
			? await promptIfMissing(rl, flags.authClientId, "GitHub OAuth Client ID")
			: undefined;
	const authClientSecret =
		authMode === "github"
			? await promptIfMissing(rl, flags.authClientSecret, "GitHub OAuth Client Secret")
			: undefined;
	const authCallbackUrl =
		authMode === "github"
			? await promptIfMissing(
					rl,
					flags.authCallbackUrl,
					"GitHub OAuth Callback URL",
					"http://localhost:8080/api/auth/callback",
				)
			: undefined;
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

	let tunnelDomain = flags.tunnelDomain;
	let tunnelToken = flags.tunnelToken;

	if (!tunnelDomain && rl) {
		const enableTunnel = await rl.question("Enable Cloudflare Tunnel? (y/N): ");
		if (enableTunnel.trim().toLowerCase() === "y") {
			tunnelDomain = await promptIfMissing(rl, undefined, "Domain (e.g. rockpool.example.com)");
			tunnelToken =
				(await rl.question("Tunnel token (or run 'rockpool tunnel setup' later): ")).trim() ||
				undefined;
		}
	}

	rl?.close();

	if (tunnelDomain && !tunnelToken) {
		process.stdout.write(
			`\nHint: run 'rockpool tunnel setup ${tunnelDomain}' to create a tunnel and obtain a token.\n\n`,
		);
	}

	const config = buildConfig({
		authMode,
		authUsername,
		authPassword,
		authClientId,
		authClientSecret,
		authCallbackUrl,
		portHttp,
		portIde,
		portPreview,
		logLevel,
		runtime,
		spaProxyUrl,
		tunnelDomain,
		tunnelToken,
	});

	const stripped = { ...config };
	delete stripped.$schema;
	RockpoolConfigSchema.parse(stripped);

	const outputFile = flags.output ?? "rockpool.config.json";
	const outputPath = resolve(process.cwd(), outputFile);
	writeFileSync(outputPath, `${JSON.stringify(config, null, "\t")}\n`);

	process.stdout.write(`Created ${outputFile}\n`);
}
