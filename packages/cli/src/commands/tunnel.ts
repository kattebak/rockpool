import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

interface CloudflareCredentials {
	apiToken: string;
	accountId: string;
}

interface CloudflareApiResponse {
	success: boolean;
	errors: Array<{ code: number; message: string }>;
	result: unknown;
}

interface TunnelSetupFlags {
	apiToken?: string;
	accountId?: string;
}

function parseSetupFlags(args: string[]): { domain: string; flags: TunnelSetupFlags } {
	const { values, positionals } = parseArgs({
		args,
		options: {
			"api-token": { type: "string" },
			"account-id": { type: "string" },
		},
		allowPositionals: true,
		strict: true,
	});

	const domain = positionals[0];
	if (!domain) {
		throw new Error(
			"Usage: rockpool tunnel setup <domain>\n\nExample: rockpool tunnel setup rockpool.example.com",
		);
	}

	return {
		domain,
		flags: {
			apiToken: values["api-token"] as string | undefined,
			accountId: values["account-id"] as string | undefined,
		},
	};
}

function loadCloudflareFile(projectRoot: string): Record<string, string> {
	const cfFile = resolve(projectRoot, ".cloudflare");
	if (!existsSync(cfFile)) return {};

	const content = readFileSync(cfFile, "utf-8");
	const vars: Record<string, string> = {};
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIndex = trimmed.indexOf("=");
		if (eqIndex === -1) continue;
		const key = trimmed.slice(0, eqIndex).trim();
		const value = trimmed.slice(eqIndex + 1).trim();
		vars[key] = value;
	}
	return vars;
}

function resolveCredentials(flags: TunnelSetupFlags, projectRoot: string): CloudflareCredentials {
	const cfVars = loadCloudflareFile(projectRoot);

	const apiToken = flags.apiToken ?? process.env.CF_API_TOKEN ?? cfVars.CF_API_TOKEN;
	const accountId = flags.accountId ?? process.env.CF_ACCOUNT_ID ?? cfVars.CF_ACCOUNT_ID;

	const missing: string[] = [];
	if (!apiToken) missing.push("CF_API_TOKEN");
	if (!accountId) missing.push("CF_ACCOUNT_ID");

	if (missing.length > 0) {
		throw new Error(
			`Missing required Cloudflare credentials: ${missing.join(", ")}\n\n` +
				"Provide them via:\n" +
				"  - CLI flags: --api-token, --account-id\n" +
				"  - Environment variables: CF_API_TOKEN, CF_ACCOUNT_ID\n" +
				"  - .cloudflare file in project root (key=value format)",
		);
	}

	return { apiToken: apiToken as string, accountId: accountId as string };
}

async function cfApi(
	method: string,
	endpoint: string,
	apiToken: string,
	body?: unknown,
): Promise<CloudflareApiResponse> {
	const options: RequestInit = {
		method,
		headers: {
			Authorization: `Bearer ${apiToken}`,
			"Content-Type": "application/json",
		},
	};

	if (body !== undefined) {
		options.body = JSON.stringify(body);
	}

	const response = await fetch(`${CF_API_BASE}${endpoint}`, options);
	const data = (await response.json()) as CloudflareApiResponse;
	return data;
}

function assertApiSuccess(response: CloudflareApiResponse, context: string): void {
	if (response.success) return;

	const errors = response.errors.map((e) => `  - ${e.code}: ${e.message}`).join("\n");
	throw new Error(`${context} failed:\n${errors}`);
}

async function lookupZoneId(domain: string, apiToken: string): Promise<string> {
	const parts = domain.split(".");
	const baseDomain = parts.slice(-2).join(".");

	const response = await cfApi("GET", `/zones?name=${baseDomain}`, apiToken);
	assertApiSuccess(response, "Zone lookup");

	const results = response.result as Array<{ id: string }>;
	if (!Array.isArray(results) || results.length === 0) {
		throw new Error(
			`No zone found for domain "${baseDomain}". Ensure the domain is in your Cloudflare account.`,
		);
	}

	return results[0].id;
}

function readConfigFile(configPath: string): Record<string, unknown> {
	if (!existsSync(configPath)) return {};
	const raw = readFileSync(configPath, "utf-8");
	return JSON.parse(raw) as Record<string, unknown>;
}

function writeConfigFile(configPath: string, config: Record<string, unknown>): void {
	writeFileSync(configPath, `${JSON.stringify(config, null, "\t")}\n`);
}

function findProjectRoot(): string {
	let dir = process.cwd();
	while (dir !== "/") {
		if (existsSync(resolve(dir, "package.json"))) {
			const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf-8")) as Record<
				string,
				unknown
			>;
			if (pkg.name === "rockpool") return dir;
		}
		dir = resolve(dir, "..");
	}
	return process.cwd();
}

function findConfigPath(): string {
	const cwd = process.cwd();
	const configFile = resolve(cwd, "rockpool.config.json");
	if (existsSync(configFile)) return configFile;
	return configFile;
}

async function tunnelSetup(args: string[]): Promise<void> {
	const { domain, flags } = parseSetupFlags(args);
	const projectRoot = findProjectRoot();
	const credentials = resolveCredentials(flags, projectRoot);
	const configPath = findConfigPath();
	const config = readConfigFile(configPath);

	if (config.tunnel) {
		throw new Error(
			"Tunnel is already configured in rockpool.config.json.\nRun 'rockpool tunnel teardown' first to remove the existing tunnel.",
		);
	}

	process.stdout.write("Creating Cloudflare Tunnel...\n\n");

	const tunnelSecret = randomBytes(32).toString("base64");

	process.stdout.write("Creating tunnel 'rockpool'...\n");
	const createResponse = await cfApi(
		"POST",
		`/accounts/${credentials.accountId}/cfd_tunnel`,
		credentials.apiToken,
		{
			name: "rockpool",
			tunnel_secret: tunnelSecret,
			config_src: "cloudflare",
		},
	);
	assertApiSuccess(createResponse, "Create tunnel");

	const tunnelResult = createResponse.result as { id: string };
	const tunnelId = tunnelResult.id;
	process.stdout.write(`  Tunnel ID: ${tunnelId}\n\n`);

	process.stdout.write("Configuring ingress rules...\n");
	const configResponse = await cfApi(
		"PUT",
		`/accounts/${credentials.accountId}/cfd_tunnel/${tunnelId}/configurations`,
		credentials.apiToken,
		{
			config: {
				ingress: [
					{ hostname: domain, service: "http://caddy:8080" },
					{ hostname: `ide.${domain}`, service: "http://caddy:8081" },
					{ hostname: `preview.${domain}`, service: "http://caddy:8082" },
					{ service: "http_status:404" },
				],
			},
		},
	);
	assertApiSuccess(configResponse, "Configure tunnel ingress");
	process.stdout.write(`  Ingress configured for: ${domain}, ide.${domain}, preview.${domain}\n\n`);

	process.stdout.write("Looking up zone ID...\n");
	const zoneId = await lookupZoneId(domain, credentials.apiToken);
	process.stdout.write(`  Zone ID: ${zoneId}\n\n`);

	process.stdout.write("Creating DNS records...\n");
	const tunnelCname = `${tunnelId}.cfargotunnel.com`;

	for (const hostname of [domain, `ide.${domain}`, `preview.${domain}`]) {
		const dnsResponse = await cfApi("POST", `/zones/${zoneId}/dns_records`, credentials.apiToken, {
			type: "CNAME",
			name: hostname,
			content: tunnelCname,
			proxied: true,
			comment: "rockpool-tunnel",
		});
		assertApiSuccess(dnsResponse, `Create DNS record for ${hostname}`);
		const record = dnsResponse.result as { id: string };
		process.stdout.write(`  ${hostname} -> ${tunnelCname} (record: ${record.id})\n`);
	}

	process.stdout.write("\nRetrieving tunnel token...\n");
	const tokenResponse = await cfApi(
		"GET",
		`/accounts/${credentials.accountId}/cfd_tunnel/${tunnelId}/token`,
		credentials.apiToken,
	);
	assertApiSuccess(tokenResponse, "Retrieve tunnel token");
	const tunnelToken = tokenResponse.result as string;

	process.stdout.write("Updating rockpool.config.json...\n");
	config.tunnel = { domain, token: tunnelToken };
	config.urls = {
		ide: `https://ide.${domain}`,
		preview: `https://preview.${domain}`,
	};
	if (!config.server) {
		config.server = { secureCookies: true };
	} else {
		(config.server as Record<string, unknown>).secureCookies = true;
	}
	writeConfigFile(configPath, config);

	process.stdout.write(`\nTunnel setup complete.\n\n`);
	process.stdout.write(`  Domain:   ${domain}\n`);
	process.stdout.write(`  IDE:      ide.${domain}\n`);
	process.stdout.write(`  Preview:  preview.${domain}\n`);
	process.stdout.write(`  Config:   ${configPath}\n\n`);
	process.stdout.write(`Run 'rockpool run' to start the stack with the tunnel.\n`);
}

async function tunnelTeardown(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			"api-token": { type: "string" },
			"account-id": { type: "string" },
		},
		strict: true,
	});

	const projectRoot = findProjectRoot();
	const flags: TunnelSetupFlags = {
		apiToken: values["api-token"] as string | undefined,
		accountId: values["account-id"] as string | undefined,
	};
	const credentials = resolveCredentials(flags, projectRoot);
	const configPath = findConfigPath();
	const config = readConfigFile(configPath);

	const tunnelConfig = config.tunnel as { domain: string; token: string } | undefined;
	if (!tunnelConfig) {
		throw new Error(
			"No tunnel configured in rockpool.config.json.\nRun 'rockpool tunnel setup <domain>' first.",
		);
	}

	const domain = tunnelConfig.domain;

	process.stdout.write("Tearing down Cloudflare Tunnel...\n\n");

	process.stdout.write("Looking up zone ID...\n");
	const zoneId = await lookupZoneId(domain, credentials.apiToken);

	process.stdout.write("Deleting DNS records...\n");
	const dnsListResponse = await cfApi(
		"GET",
		`/zones/${zoneId}/dns_records?type=CNAME&comment=rockpool-tunnel`,
		credentials.apiToken,
	);
	assertApiSuccess(dnsListResponse, "List DNS records");

	const dnsRecords = dnsListResponse.result as Array<{ id: string; name: string }>;
	for (const record of dnsRecords) {
		const deleteResponse = await cfApi(
			"DELETE",
			`/zones/${zoneId}/dns_records/${record.id}`,
			credentials.apiToken,
		);
		if (deleteResponse.success) {
			process.stdout.write(`  Deleted: ${record.name} (${record.id})\n`);
		} else {
			process.stdout.write(`  Warning: failed to delete ${record.name} (may already be deleted)\n`);
		}
	}

	process.stdout.write("\nLooking up tunnel ID...\n");
	const tunnelsResponse = await cfApi(
		"GET",
		`/accounts/${credentials.accountId}/cfd_tunnel?name=rockpool&is_deleted=false`,
		credentials.apiToken,
	);
	assertApiSuccess(tunnelsResponse, "List tunnels");

	const tunnels = tunnelsResponse.result as Array<{ id: string; name: string }>;
	for (const tun of tunnels) {
		process.stdout.write(`Deleting tunnel ${tun.id}...\n`);

		await cfApi(
			"PUT",
			`/accounts/${credentials.accountId}/cfd_tunnel/${tun.id}/configurations`,
			credentials.apiToken,
			{ config: { ingress: [{ service: "http_status:404" }] } },
		);

		let deleteResponse = await cfApi(
			"DELETE",
			`/accounts/${credentials.accountId}/cfd_tunnel/${tun.id}`,
			credentials.apiToken,
		);

		if (!deleteResponse.success) {
			deleteResponse = await cfApi(
				"DELETE",
				`/accounts/${credentials.accountId}/cfd_tunnel/${tun.id}?cascade=true`,
				credentials.apiToken,
			);
		}

		if (deleteResponse.success) {
			process.stdout.write(`  Tunnel deleted.\n`);
		} else {
			process.stdout.write(`  Warning: could not delete tunnel. Check the Cloudflare dashboard.\n`);
		}
	}

	process.stdout.write("\nUpdating rockpool.config.json...\n");
	delete config.tunnel;
	delete config.urls;
	writeConfigFile(configPath, config);

	process.stdout.write("\nTeardown complete.\n");
}

async function tunnelStatus(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			"api-token": { type: "string" },
			"account-id": { type: "string" },
		},
		strict: true,
	});

	const projectRoot = findProjectRoot();
	const flags: TunnelSetupFlags = {
		apiToken: values["api-token"] as string | undefined,
		accountId: values["account-id"] as string | undefined,
	};
	const credentials = resolveCredentials(flags, projectRoot);
	const configPath = findConfigPath();
	const config = readConfigFile(configPath);

	const tunnelConfig = config.tunnel as { domain: string; token: string } | undefined;
	if (!tunnelConfig) {
		throw new Error(
			"No tunnel configured in rockpool.config.json.\nRun 'rockpool tunnel setup <domain>' first.",
		);
	}

	process.stdout.write("Tunnel Status\n\n");
	process.stdout.write(`  Domain: ${tunnelConfig.domain}\n\n`);

	const tunnelsResponse = await cfApi(
		"GET",
		`/accounts/${credentials.accountId}/cfd_tunnel?name=rockpool&is_deleted=false`,
		credentials.apiToken,
	);
	assertApiSuccess(tunnelsResponse, "List tunnels");

	const tunnels = tunnelsResponse.result as Array<{
		id: string;
		name: string;
		status: string;
		connections: Array<{ id: string; colo_name: string; origin_ip?: string }>;
	}>;

	if (tunnels.length === 0) {
		process.stdout.write("  No active tunnel found.\n");
		return;
	}

	for (const tun of tunnels) {
		process.stdout.write(`  Name:       ${tun.name}\n`);
		process.stdout.write(`  Tunnel ID:  ${tun.id}\n`);
		process.stdout.write(`  Status:     ${tun.status}\n`);

		const connections = tun.connections ?? [];
		process.stdout.write(`  Connectors: ${connections.length}\n`);

		if (connections.length > 0) {
			process.stdout.write("\n  Connected from:\n");
			for (const conn of connections) {
				process.stdout.write(
					`    - ${conn.colo_name} (id: ${conn.id.slice(0, 8)}..., origin: ${conn.origin_ip ?? "unknown"})\n`,
				);
			}
		}
	}
}

const TUNNEL_USAGE = `Usage: rockpool tunnel <command> [options]

Commands:
  setup <domain>   Create tunnel, configure ingress, create DNS records
  teardown         Delete DNS records and tunnel, remove tunnel from config
  status           Show tunnel connection status

Options:
  --api-token      Cloudflare API token (or set CF_API_TOKEN)
  --account-id     Cloudflare account ID (or set CF_ACCOUNT_ID)
`;

export async function tunnel(args: string[]): Promise<void> {
	const subcommand = args[0];
	const subArgs = args.slice(1);

	if (!subcommand || subcommand === "--help") {
		process.stdout.write(TUNNEL_USAGE);
		if (!subcommand) process.exit(1);
		return;
	}

	const subcommands: Record<string, (args: string[]) => Promise<void>> = {
		setup: tunnelSetup,
		teardown: tunnelTeardown,
		status: tunnelStatus,
	};

	const handler = subcommands[subcommand];
	if (!handler) {
		process.stderr.write(`Unknown tunnel command: ${subcommand}\n\n${TUNNEL_USAGE}`);
		process.exit(1);
	}

	await handler(subArgs);
}
