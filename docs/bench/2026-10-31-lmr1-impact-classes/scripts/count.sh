#!/bin/sh
# Classify every record of the two zips fetch.sh downloaded with the impact.ts of LMR1d (f25d51b), of LMR1f (84ef289)
# and the worktree's (count.mjs) with --network none, and print the counts as JSON; with --stronger, the records that
# moved to a stronger class instead. Node 24 strips impact.ts's types itself. The two earlier files are written from
# git show into /w/osv/impact-before-lmr1e2.ts (f25d51b) and /w/osv/impact-before-lmr1g.ts (84ef289) (README).
set -eu
lmr1d=/w/osv/impact-before-lmr1e2.ts
lmr1f=/w/osv/impact-before-lmr1g.ts
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), impact.ts sha256 $(sha256sum /src/packages/cli/src/security/impact.ts | cut -c1-64), LMR1f (84ef289) sha256 $(sha256sum $lmr1f | cut -c1-64), LMR1d (f25d51b) sha256 $(sha256sum $lmr1d | cut -c1-64)" >&2
sha256sum /w/osv/npm.zip /w/osv/Packagist.zip >&2
node /scripts/count.mjs /w/osv /src/packages/cli/src/security/impact.ts $lmr1f $lmr1d "$@"
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
