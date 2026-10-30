#!/bin/sh
# With network: copy the worktree into /w (keeping /w/node_modules) and run npm ci there. The tests then run in another
# container with --network none (test-offline.sh).
set -u
sh /scripts/sync.sh
cd /w
npm ci --no-audit --no-fund >/tmp/ci.log 2>&1; code=$?; echo "npm ci exit $code"; [ $code -eq 0 ] || tail -20 /tmp/ci.log
