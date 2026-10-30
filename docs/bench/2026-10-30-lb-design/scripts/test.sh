#!/bin/sh
# Typecheck and the CLI tests, in node:24-slim with git (image ludion-l9-node24-git). Arguments go to vitest.
set -u
sh /scripts/sync.sh
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version)"
npm ci --no-audit --no-fund >/tmp/ci.log 2>&1; echo "npm ci exit $?"
echo "== npx tsc -p tsconfig.json"; npx tsc -p tsconfig.json; echo "tsc exit $?"
echo "== npx vitest run --project node $*"; NO_COLOR=1 npx vitest run --project node "$@"; echo "vitest exit $?"
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
