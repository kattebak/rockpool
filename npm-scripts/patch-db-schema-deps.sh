#!/usr/bin/env bash
# Patch the generated db-schema package.json to use the correct drizzle-orm beta version.
# The emitter hardcodes drizzle-orm@^1.0.0 which doesn't exist on npm yet.
# Remove this script once drizzle-orm 1.0.0 stable is released.

set -euo pipefail

dir="${1:?Usage: patch-db-schema-deps.sh <dir> <drizzle-version>}"
version="${2:?Usage: patch-db-schema-deps.sh <dir> <drizzle-version>}"
pkg="$dir/package.json"

if [ ! -f "$pkg" ]; then
  exit 0
fi

node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$pkg', 'utf8'));
if (pkg.dependencies?.['drizzle-orm']) {
  pkg.dependencies['drizzle-orm'] = '$version';
  fs.writeFileSync('$pkg', JSON.stringify(pkg, null, 2) + '\n');
}
"
