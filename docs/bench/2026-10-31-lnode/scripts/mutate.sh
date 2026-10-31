#!/bin/sh
# No network: the mutations of mutate.mjs in /w (as ci.sh left it), each against the tests that should catch it.
set -u
echo "# at commit ${LN_HEAD:-unknown}, ${LN_DIRTY:-unknown} files differing from it"
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
node /scripts/mutate.mjs
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
