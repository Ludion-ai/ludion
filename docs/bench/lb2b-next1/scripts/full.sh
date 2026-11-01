#!/usr/bin/env bash
# Inside the container, no network: sync, typecheck, build, then the whole test suite; outputs in /logs.
set -uo pipefail
bash /s/sync.sh >/dev/null
cd /w/repo
npm run typecheck > /logs/${PFX:-}typecheck.log 2>&1; echo "typecheck exit $?"
npm run build > /logs/${PFX:-}build.log 2>&1; echo "build exit $?"
NO_COLOR=1 npx vitest run > /logs/${PFX:-}tests-all.log 2>&1; echo "vitest exit $?"
grep -E "^ FAIL|Test Files|Tests " /logs/${PFX:-}tests-all.log | tail -30
