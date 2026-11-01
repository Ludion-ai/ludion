#!/usr/bin/env bash
# Inside the container, no network: sync, then run vitest on the files given; the whole output goes to /w/logs/$LOG.
set -uo pipefail
bash /src/docs/bench/lexp/scripts/sync.sh >/dev/null
mkdir -p /w/logs
cd /w/repo
NO_COLOR=1 npx vitest run "$@" > "/w/logs/$LOG" 2>&1
status=$?
grep -E "^ (FAIL|✓|×)|Test Files|Tests |FAIL |AssertionError|Error:" "/w/logs/$LOG" | head -${TAILN:-60}
exit $status
