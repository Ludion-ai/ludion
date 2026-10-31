#!/bin/sh
# Classify every record of the two zips fetch.sh downloaded with the impact.ts before LMR1e-2 and the worktree's
# (count.mjs) with --network none, and print the counts as JSON; with --stronger, the records that moved to a stronger
# class instead. Node 24 strips impact.ts's types itself. The impact.ts before is /w/osv/impact-before-lmr1e2.ts,
# written from git show f25d51b:packages/cli/src/security/impact.ts (README).
set -eu
before=/w/osv/impact-before-lmr1e2.ts
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), impact.ts sha256 $(sha256sum /src/packages/cli/src/security/impact.ts | cut -c1-64), before LMR1e-2 sha256 $(sha256sum $before | cut -c1-64)" >&2
sha256sum /w/osv/npm.zip /w/osv/Packagist.zip >&2
node /scripts/count.mjs /w/osv /src/packages/cli/src/security/impact.ts $before "$@"
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
