#!/bin/sh
# Typecheck and the CLI tests, with --network none, on node_modules from setup.sh. Arguments go to vitest.
set -u
sh /scripts/sync.sh
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version)"
echo "== npx tsc -p tsconfig.json"; npx tsc -p tsconfig.json; echo "tsc exit $?"
echo "== npx vitest run --project node packages/cli/test $*"; NO_COLOR=1 npx vitest run --project node packages/cli/test "$@"; echo "vitest exit $?"
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
