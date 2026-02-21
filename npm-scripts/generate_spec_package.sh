#!/bin/bash

# Wraps the OpenAPI spec files in a TypeScript module.

set -euo pipefail

usage() {
  echo "Usage: $0 --scope <scope> <source_path> <build_path>"
  echo "  --scope    npm scope (e.g., @myorg)"
  exit 1
}

SCOPE=""
POSITIONAL_ARGS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --scope)
      SCOPE="$2"
      shift 2
      ;;
    -*)
      echo "Unknown option: $1"
      usage
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done

SOURCE_PATH="${POSITIONAL_ARGS[0]:-${SOURCE_PATH:-}}"
BUILD_PATH="${POSITIONAL_ARGS[1]:-${BUILD_PATH:-}}"

if [ -z "$SCOPE" ]; then
  echo "Error: --scope is required"
  usage
fi

if [ -z "$SOURCE_PATH" ]; then
  echo "Error: SOURCE_PATH is not set"
  usage
fi

if [ -z "$BUILD_PATH" ]; then
  echo "Error: BUILD_PATH is not set"
  usage
fi

mkdir -p "$BUILD_PATH"
cp $(dirname $SOURCE_PATH)/* "$BUILD_PATH"

cd "$BUILD_PATH" || exit 1

cat << EOF > index.ts
import OpenAPISpec from "./openapi.json" with { type: "json" };
import JSONSchemaSpec from "./schema.json" with { type: "json" };

export default {
    JSONSchemaSpec,
    OpenAPISpec
};
EOF

npm init --init-type module --yes --scope "$SCOPE" 1> /dev/null
npx tsc index.ts --module preserve --resolveJsonModule --esModuleInterop --declaration --skipLibCheck

# Remove index.ts after compilation to prevent TypeScript from trying to recompile it
# when other packages import from this package (tsc prefers .ts over .d.ts)
rm index.ts

# Add types field to package.json to explicitly point to declarations
npm pkg set types=index.d.ts

echo "Generated $(npm pkg get name) package in $BUILD_PATH"
