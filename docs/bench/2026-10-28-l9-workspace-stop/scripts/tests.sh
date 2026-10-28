#!/bin/sh
set -u
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v)"
echo "== npx tsc -p tsconfig.json"; npx tsc -p tsconfig.json; echo "tsc exit $?"
echo "== npx vitest run --project node packages/cli/test"; NO_COLOR=1 npx vitest run --project node packages/cli/test; echo "vitest exit $?"
echo "== node mutate.mjs"; node /s/mutate.mjs
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
