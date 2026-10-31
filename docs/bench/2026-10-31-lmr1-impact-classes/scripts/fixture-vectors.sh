#!/bin/sh
# The CWEs and CVSS scores of the test fixtures (network none).
set -eu
node /scripts/fixture-vectors.mjs /src/packages/cli/test/fixtures/impact/records.json /src/packages/cli/test/fixtures/impact/trap-records.json
