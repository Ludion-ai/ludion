#!/bin/sh
# Without network (docker run --network none), after install.sh into the same /w: copy the worktree in again (keeping
# /w/node_modules) and run every mutation (mutate.mjs, vitest with --maxWorkers=2). Mount a host folder at /results:
# each finished mutation is written to /results/mutate-results.tsv at once, and a run again at the same commit skips it.
set -u
sh /scripts/sync.sh
echo "# at commit ${LB_HEAD:-unknown}, ${LB_DIRTY:-unknown} files differing from it"
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version), network none"
[ -d /results ] && export MUTATE_RESULTS=/results/mutate-results.tsv
node /scripts/mutate.mjs
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
