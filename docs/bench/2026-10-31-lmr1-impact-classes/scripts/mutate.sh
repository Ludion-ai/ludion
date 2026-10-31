#!/bin/sh
# Mutations of impact.ts against impact.test.ts (network none), on the copy in /w.
set -u
sh /scripts/sync.sh
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v)"
node /scripts/mutate.mjs
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
