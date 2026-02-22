import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import tailwindPlugin from "esbuild-plugin-tailwindcss";

const Dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(Dirname, "..");

const PORT = Number(process.env.PORT) || 5173;
const API_PROXY = process.env.API_URL || "http://localhost:7163";
const ESBUILD_PORT = PORT + 1;

const indexHtml = await readFile(resolve(projectRoot, "public/index.html"), "utf-8");

const context = await esbuild.context({
	entryPoints: [resolve(projectRoot, "src/main.tsx")],
	bundle: true,
	sourcemap: true,
	format: "esm",
	outdir: resolve(projectRoot, "dist/assets"),
	entryNames: "[name]",
	splitting: true,
	plugins: [tailwindPlugin()],
	alias: {
		"@": resolve(projectRoot, "src"),
	},
	define: {
		"process.env.NODE_ENV": '"development"',
	},
	logLevel: "info",
});

await context.serve({
	servedir: resolve(projectRoot, "dist"),
	port: ESBUILD_PORT,
});

function collectBody(stream: NodeJS.ReadableStream): Promise<Buffer> {
	const chunks: Buffer[] = [];
	return new Promise((resolve, reject) => {
		stream.on("data", (chunk: Buffer) => chunks.push(chunk));
		stream.on("end", () => resolve(Buffer.concat(chunks)));
		stream.on("error", reject);
	});
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

	if (url.pathname.startsWith("/api/")) {
		const proxyUrl = new URL(url.pathname + url.search, API_PROXY);
		const headers: Record<string, string> = {};
		for (const [key, value] of Object.entries(req.headers)) {
			if (value) headers[key] = Array.isArray(value) ? value[0] : value;
		}
		delete headers.host;

		const hasBody = req.method !== "GET" && req.method !== "HEAD";
		const bodyBuffer = hasBody ? await collectBody(req) : undefined;

		const proxyRes = await fetch(proxyUrl, {
			method: req.method,
			headers,
			body: bodyBuffer ? new Uint8Array(bodyBuffer) : undefined,
		});

		res.writeHead(proxyRes.status, Object.fromEntries(proxyRes.headers));
		const responseBody = await proxyRes.arrayBuffer();
		res.end(Buffer.from(responseBody));
		return;
	}

	if (url.pathname.startsWith("/app/assets/")) {
		const assetPath = url.pathname.replace("/app/", "/");
		const esbuildUrl = `http://127.0.0.1:${ESBUILD_PORT}${assetPath}`;
		const assetRes = await fetch(esbuildUrl);
		res.writeHead(assetRes.status, {
			"content-type": assetRes.headers.get("content-type") ?? "application/octet-stream",
		});
		const assetBody = await assetRes.arrayBuffer();
		res.end(Buffer.from(assetBody));
		return;
	}

	if (url.pathname.startsWith("/app")) {
		res.writeHead(200, { "content-type": "text/html" });
		res.end(indexHtml);
		return;
	}

	res.writeHead(302, { location: "/app/workspaces" });
	res.end();
});

server.listen(PORT, () => {
	console.log(`Dev server: http://localhost:${PORT}/app/workspaces`);
	console.log(`API proxy: ${API_PROXY}`);
});

process.on("SIGINT", () => {
	context.dispose();
	server.close();
	process.exit(0);
});
