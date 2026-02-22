#!/bin/bash

# Generates a TypeScript client SDK from the OpenAPI spec.
# Uses @kattebak/openapi-generator-ts with the typescript-fetch generator.

set -euo pipefail

OPENAPI_SPEC="${1:?Usage: $0 <openapi-spec> <output-dir>}"
OUTPUT_DIR="${2:?Usage: $0 <openapi-spec> <output-dir>}"

npx ts-openapi-generator generate \
  -i "$OPENAPI_SPEC" \
  -g typescript-fetch \
  -o "$OUTPUT_DIR" \
  --additional-properties npmName=@rockpool/sdk,npmVersion=0.0.1

# Patch package.json for ESM + workspace compatibility
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('${OUTPUT_DIR}/package.json', 'utf8'));
pkg.private = true;
pkg.type = 'module';
delete pkg.module;
delete pkg.scripts;
delete pkg.devDependencies;
pkg.exports = { '.': './index.ts' };
fs.writeFileSync('${OUTPUT_DIR}/package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo "Generated @rockpool/sdk in $OUTPUT_DIR"
