#!/bin/sh
# Classify every record of the two zips fetch.sh downloaded with the worktree's impact.ts and with the one before LMR1c
# (network none), and print the counts as JSON; with --words, the records malware-or-malicious.tsv lists instead. Node 24
# strips impact.ts's types itself. The impact.ts before LMR1c is /w/osv/impact-before-lmr1c.ts, written from
# git show 218a83a:packages/cli/src/security/impact.ts (README).
set -eu
before=/w/osv/impact-before-lmr1c.ts
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), impact.ts sha256 $(sha256sum /src/packages/cli/src/security/impact.ts | cut -c1-64), before LMR1c sha256 $(sha256sum $before | cut -c1-64)" >&2
sha256sum /w/osv/npm.zip /w/osv/Packagist.zip >&2
node /scripts/count.mjs /w/osv /src/packages/cli/src/security/impact.ts $before "$@"
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
