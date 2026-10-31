#!/bin/sh
# The definition of every CWE impact.ts decides (network on, no credentials, every capability dropped).
set -eu
mkdir -p /w/osv
node /scripts/cwe.mjs /w/osv /src/packages/cli/src/security/impact.ts
