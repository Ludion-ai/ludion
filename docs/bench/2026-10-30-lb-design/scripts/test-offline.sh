#!/bin/sh
# Without network (docker run --network none), after install.sh: typecheck, build and the node-project tests, in a copy of
# the worktree with its own Git repository (apps/site's tests ask Git for the top folder), vitest with --maxWorkers=2.
# Arguments go to vitest.
set -u
sh /scripts/sync.sh
echo "# at commit ${LB_HEAD:-unknown}, ${LB_DIRTY:-unknown} files differing from it"
cd /w
G() { git -c user.name=copy -c user.email=copy@example.invalid "$@"; }
G init -q . && G add -A >/dev/null && G commit -qm copy
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version), network none"
npm run typecheck; echo "typecheck exit $?"
npm run build >/tmp/build.log 2>&1; echo "build exit $?"; tail -3 /tmp/build.log
NO_COLOR=1 npx vitest run --project node --maxWorkers=2 "$@"; echo "vitest exit $?"
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
