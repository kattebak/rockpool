import type { RockpoolConfig } from "@rockpool/config";
import { stringify } from "yaml";

interface ComposeOptions {
	config: RockpoolConfig;
	projectRoot: string;
	configFileName: string;
	podmanSocket?: string;
}

interface ComposeService {
	image?: string;
	build?: string;
	command?: string;
	init?: boolean;
	working_dir?: string;
	environment?: Record<string, string>;
	ports?: string[];
	restart?: string;
	volumes?: string[];
	depends_on?: string[];
	security_opt?: string[];
}

interface ComposeDocument {
	services: Record<string, ComposeService>;
	volumes: Record<string, { name: string } | null>;
}

function detectPodmanSocket(): string {
	const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
	if (process.platform === "linux" && xdgRuntimeDir) {
		return `${xdgRuntimeDir}/podman/podman.sock`;
	}
	return "/var/run/docker.sock";
}

export function generateCompose(options: ComposeOptions): string {
	const { config, projectRoot, configFileName } = options;
	const { ports } = config;
	const podmanSocket = options.podmanSocket ?? detectPodmanSocket();

	const compose: ComposeDocument = {
		services: {
			caddy: {
				image: "docker.io/library/caddy:2",
				command: "caddy run --config /etc/caddy/Caddyfile --adapter caddyfile",
				environment: {
					CADDY_ADMIN_PORT: String(ports.caddy),
				},
				ports: [
					`${ports.caddy}:${ports.caddy}`,
					`${ports.http}:${ports.http}`,
					`${ports.ide}:${ports.ide}`,
					`${ports.preview}:${ports.preview}`,
				],
				restart: "unless-stopped",
				volumes: [
					"caddy-data:/data",
					"caddy-config:/config",
					`${projectRoot}/Caddyfile:/etc/caddy/Caddyfile:ro`,
				],
			},
			elasticmq: {
				image: "docker.io/softwaremill/elasticmq-native",
				restart: "unless-stopped",
				ports: ["9324:9324"],
				volumes: [`${projectRoot}/elasticmq.conf:/opt/elasticmq.conf:ro`],
			},
			"control-plane": {
				build: `${projectRoot}/images/control-plane`,
				init: true,
				working_dir: "/app",
				environment: {
					ROCKPOOL_CONFIG: `/app/${configFileName}`,
					CONTAINER_HOST: "unix:///run/podman.sock",
					CONTROL_PLANE_HOST: "control-plane",
					PORT: "7163",
					CADDY_ADMIN_URL: `http://caddy:${ports.caddy}`,
					SRV0_PORT: String(ports.http),
					SRV1_PORT: String(ports.ide),
					SRV2_PORT: String(ports.preview),
					DB_PATH: "rockpool.db",
					QUEUE_ENDPOINT: "http://elasticmq:9324",
					QUEUE_URL: "http://elasticmq:9324/000000000000/workspace-jobs",
					CONTAINER_HOST_ADDRESS: "host.containers.internal",
					SPA_PROXY_URL: config.spa.proxyUrl || "",
				},
				security_opt: ["label=disable"],
				restart: "unless-stopped",
				volumes: [
					`${projectRoot}:/app`,
					"node-modules:/app/node_modules",
					"rockpool-data:/opt/rockpool",
					`${podmanSocket}:/run/podman.sock`,
				],
				depends_on: ["caddy", "elasticmq"],
			},
		},
		volumes: {
			"caddy-data": null,
			"caddy-config": null,
			"rockpool-data": null,
			"node-modules": { name: "rockpool-node-modules" },
		},
	};

	return stringify(compose);
}
