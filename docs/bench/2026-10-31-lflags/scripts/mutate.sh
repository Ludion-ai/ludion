#!/bin/sh
# In /w, which test.sh synced and installed: the mutations of mutate.mjs, with no network.
set -u
sh /scripts/sync.sh
echo "# at commit ${LB_HEAD:-unknown}, ${LB_DIRTY:-unknown} files differing from it"
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version)"
node /scripts/mutate.mjs
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
