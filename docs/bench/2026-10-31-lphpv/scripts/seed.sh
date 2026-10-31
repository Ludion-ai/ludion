#!/bin/sh
# No network: node_modules from LNODE's volume (read-only at /from) into /w, then the worktree into /w (sync.sh).
set -eu
echo "# at commit ${LN_HEAD:-unknown}, ${LN_DIRTY:-unknown} files differing from it; node $(node -v)"
cmp /from/package-lock.json /src/package-lock.json && echo "# package-lock.json equals LNODE's"
rm -rf /w/node_modules && cp -a /from/node_modules /w/node_modules
sh /scripts/sync.sh
echo "seed exit 0"
