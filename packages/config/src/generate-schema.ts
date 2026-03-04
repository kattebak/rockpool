import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { RockpoolConfigSchema } from "./schema.ts";

const jsonSchema = zodToJsonSchema(RockpoolConfigSchema, {
	name: "RockpoolConfig",
	$refStrategy: "none",
});

const outputPath = resolve(import.meta.dirname, "../rockpool.schema.json");
writeFileSync(outputPath, `${JSON.stringify(jsonSchema, null, 2)}\n`);

console.log(`Generated JSON Schema at ${outputPath}`);
