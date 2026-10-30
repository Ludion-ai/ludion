#!/bin/sh
# Typecheck, build and every node-project test, in node:24-slim with git (image ludion-l9-node24-git), in a copy of the
# worktree with its own Git repository (apps/site's tests ask Git for the top folder). Arguments go to vitest.
set -u
sh /scripts/sync.sh
echo "# at commit ${LB_HEAD:-unknown}, ${LB_DIRTY:-unknown} files differing from it"
cd /w
G() { git -c user.name=copy -c user.email=copy@example.invalid "$@"; }
G init -q . && G add -A >/dev/null && G commit -qm copy
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version)"
npm ci --no-audit --no-fund >/tmp/ci.log 2>&1; echo "npm ci exit $?"
npm run typecheck; echo "typecheck exit $?"
npm run build >/tmp/build.log 2>&1; echo "build exit $?"; tail -3 /tmp/build.log
NO_COLOR=1 npx vitest run --project node "$@"; echo "vitest exit $?"
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
