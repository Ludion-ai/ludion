#!/bin/sh
# scripts/mutate.mjs on a fresh copy of the worktree in /w (image ludion-l9-node24-git).
set -u
sh /scripts/sync.sh
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v)"
npm ci --no-audit --no-fund >/tmp/ci.log 2>&1; echo "npm ci exit $?"
node /scripts/mutate.mjs
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
