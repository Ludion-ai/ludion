#!/bin/sh
# With network: the worktree into /w (node_modules kept), then npm ci from the lockfile, scripts off.
set -u
sh /scripts/sync.sh
cd /w
echo "# at commit ${LN_HEAD:-unknown}, ${LN_DIRTY:-unknown} files differing from it; node $(node -v)"
npm ci --no-audit --no-fund --ignore-scripts >/tmp/ci.log 2>&1; echo "npm ci exit $?"; tail -3 /tmp/ci.log
