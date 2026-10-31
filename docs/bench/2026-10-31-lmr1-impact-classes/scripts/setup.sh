#!/bin/sh
# npm ci into the volume (network on), so test.sh can run with --network none.
set -u
sh /scripts/sync.sh
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v)"
npm ci --no-audit --no-fund >/tmp/ci.log 2>&1; echo "npm ci exit $?"; tail -3 /tmp/ci.log
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
