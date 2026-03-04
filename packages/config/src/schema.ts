import { z } from "zod";

const LogLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]);
const RuntimeSchema = z.enum(["podman", "stub"]);

const ServerSchema = z.object({
	secureCookies: z.boolean().default(false),
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

const SpaSchema = z.object({
	root: z.string().default(""),
	proxyUrl: z.string().default(""),
});

const UrlsSchema = z.object({
	ide: z.string().url(),
	preview: z.string().url(),
});

export const RockpoolConfigSchema = z.object({
	logLevel: LogLevelSchema.default("info"),
	runtime: RuntimeSchema.default("podman"),
	server: ServerSchema.default({}),
	auth: AuthSchema,
	spa: SpaSchema.default({}),
	urls: UrlsSchema.optional(),
});
