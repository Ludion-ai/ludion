#!/bin/sh
# Print the real OSV records kept as test fixtures (network none); the host redirects them into
# packages/cli/test/fixtures/impact/records.json.
set -eu
node /scripts/pick.mjs /w/osv /src/packages/cli/src/security/impact.ts
