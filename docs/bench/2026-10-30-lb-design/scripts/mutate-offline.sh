#!/bin/sh
# Without network (docker run --network none), after install.sh into the same /w: copy the worktree in again (keeping
# /w/node_modules) and run every mutation (mutate.mjs, vitest with --maxWorkers=2).
set -u
sh /scripts/sync.sh
echo "# at commit ${LB_HEAD:-unknown}, ${LB_DIRTY:-unknown} files differing from it"
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version), network none"
node /scripts/mutate.mjs
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
