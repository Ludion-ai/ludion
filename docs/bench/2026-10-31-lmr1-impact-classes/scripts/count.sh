#!/bin/sh
# Classify every record of the two zips fetch.sh downloaded with the worktree's impact.ts (network none) and print the
# counts as JSON. Node 24 strips impact.ts's types itself.
set -eu
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), impact.ts sha256 $(sha256sum /src/packages/cli/src/security/impact.ts | cut -c1-64)" >&2
node /scripts/count.mjs /w/osv /src/packages/cli/src/security/impact.ts
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
