#!/bin/sh
# No network: in /w as ci.sh left it (its npm ci included), typecheck, then vitest with two workers.
# First says whether /w still matches the worktree at /src (run ci.sh again after any change).
set -u
echo "# at commit ${LN_HEAD:-unknown}, ${LN_DIRTY:-unknown} files differing from it"
d=$(diff -rq --exclude=node_modules --exclude=.git /src /w | wc -l); echo "# /w differs from /src in $d entries"
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version)"
echo "== npx tsc -p tsconfig.json"; npx tsc -p tsconfig.json; echo "tsc exit $?"
echo "== npx vitest run --project node --maxWorkers=2 $*"; NO_COLOR=1 npx vitest run --project node --maxWorkers=2 "$@"; echo "vitest exit $?"
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
