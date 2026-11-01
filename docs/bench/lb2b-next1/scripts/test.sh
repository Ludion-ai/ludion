#!/usr/bin/env bash
# Inside the container, no network: sync, then run vitest on the files given; the whole output goes to /logs/$LOG.
set -uo pipefail
bash /s/sync.sh >/dev/null
cd /w/repo
NO_COLOR=1 npx vitest run "$@" > "/logs/$LOG" 2>&1
status=$?
grep -E "^ (FAIL|✓|×)|Test Files|Tests |FAIL " "/logs/$LOG" | tail -${TAILN:-40}
exit $status
