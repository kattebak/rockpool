#!/bin/bash

# Wraps the OpenAPI spec emitter output in a standalone npm package.

set -euo pipefail

BUILD_PATH="${1:?Usage: $0 <build-path>}"

cd "$BUILD_PATH" || exit 1

cat << 'EOF' > package.json
{
  "name": "@rockpool/openapi",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./openapi.yaml"
  }
}
EOF

echo "Generated @rockpool/openapi package in $BUILD_PATH"
