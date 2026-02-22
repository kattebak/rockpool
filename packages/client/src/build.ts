import { cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import tailwindPlugin from "esbuild-plugin-tailwindcss";

const Dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(Dirname, "..");
const outdir = resolve(projectRoot, "../../build/client");

await esbuild.build({
	entryPoints: [resolve(projectRoot, "src/main.tsx")],
	bundle: true,
	minify: true,
	sourcemap: true,
	format: "esm",
	outdir: resolve(outdir, "assets"),
	entryNames: "[name]",
	splitting: true,
	plugins: [tailwindPlugin()],
	alias: {
		"@": resolve(projectRoot, "src"),
	},
	define: {
		"process.env.NODE_ENV": '"production"',
	},
	logLevel: "info",
});

await cp(resolve(projectRoot, "public/index.html"), resolve(outdir, "index.html"));

console.log("Build complete: build/client/");
