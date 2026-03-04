import { z } from "zod";

const LogLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]);
const RuntimeSchema = z.enum(["podman", "stub"]);

const ServerSchema = z.object({
	port: z.number().int().min(1).max(65535).default(7163),
	secureCookies: z.boolean().default(false),
});

const CaddySchema = z.object({
	adminUrl: z.string().url().default("http://localhost:2019"),
	adminPort: z.number().int().min(1).max(65535).default(2019),
	srv0Port: z.number().int().min(1).max(65535).default(8080),
	srv1Port: z.number().int().min(1).max(65535).default(8081),
	srv2Port: z.number().int().min(1).max(65535).default(8082),
});

const BasicAuthSchema = z.object({
	username: z.string().min(1),
	password: z.string().min(1),
});

const GitHubAuthSchema = z.object({
	clientId: z.string().min(1),
	clientSecret: z.string().min(1),
	callbackUrl: z.string().url().default("http://localhost:8080/api/auth/callback"),
	sessionMaxAgeMs: z.number().int().positive().default(86_400_000),
});

const AuthSchema = z
	.object({
		mode: z.enum(["basic", "github"]).default("basic"),
		basic: BasicAuthSchema.optional(),
		github: GitHubAuthSchema.optional(),
	})
	.refine(
		(auth) => {
			if (auth.mode === "basic") return auth.basic !== undefined;
			if (auth.mode === "github") return auth.github !== undefined;
			return false;
		},
		{ message: "Auth credentials must be provided for the selected mode" },
	);

const DbSchema = z.object({
	path: z.string().default("rockpool.db"),
});

const QueueSchema = z.object({
	endpoint: z.string().url().default("http://localhost:9324"),
	queueUrl: z.string().url().default("http://localhost:9324/000000000000/workspace-jobs"),
});

const ContainerSchema = z.object({
	hostAddress: z.string().default("host.containers.internal"),
});

const SpaSchema = z.object({
	root: z.string().default(""),
	proxyUrl: z.string().default(""),
});

const UrlsSchema = z.object({
	dashboard: z.string().url().default("http://localhost:8080"),
	api: z.string().url().default("http://localhost:8080/api"),
	ide: z.string().url().default("http://localhost:8081"),
	preview: z.string().url().default("http://localhost:8082"),
});

export const RockpoolConfigSchema = z.object({
	logLevel: LogLevelSchema.default("info"),
	runtime: RuntimeSchema.default("podman"),
	server: ServerSchema.default({}),
	caddy: CaddySchema.default({}),
	auth: AuthSchema,
	db: DbSchema.default({}),
	queue: QueueSchema.default({}),
	container: ContainerSchema.default({}),
	spa: SpaSchema.default({}),
	urls: UrlsSchema.default({}),
});
