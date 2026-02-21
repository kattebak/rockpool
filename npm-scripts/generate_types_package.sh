#!/bin/bash

# Uses https://openapistack.co/docs/openapicmd/typegen/
# to generate a canonical TypeScript type definition package.

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

npx openapicmd typegen -D --no-remove-unreferenced --backend "$SOURCE_PATH" > "$BUILD_PATH/index.d.ts"

cd "$BUILD_PATH" || exit 1
npm config set init-license "UNLICENSED"
npm init --init-type module --yes --scope "$SCOPE" 1> /dev/null
touch index.js

echo "Generated $(npm pkg get name) package in $BUILD_PATH"
