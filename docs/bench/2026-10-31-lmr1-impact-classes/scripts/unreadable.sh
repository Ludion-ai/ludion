#!/bin/sh
# Every record whose CVSS vector the worktree's impact.ts cannot read (network none, every capability dropped).
set -eu
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), impact.ts sha256 $(sha256sum /src/packages/cli/src/security/impact.ts | cut -c1-64)" >&2
node /scripts/unreadable.mjs /src/packages/cli/src/security/impact.ts /w/osv/npm.zip /w/osv/Packagist.zip
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
