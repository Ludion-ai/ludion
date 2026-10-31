#!/bin/sh
# Print the real OSV records kept as trap test fixtures (network none); the host redirects them into
# packages/cli/test/fixtures/impact/trap-records.json.
set -eu
node /scripts/pick-trap.mjs /w/osv
