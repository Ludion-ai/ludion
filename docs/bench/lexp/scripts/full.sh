#!/usr/bin/env bash
# Inside the container, no network: sync, then typecheck, build and every unit test; each output goes to /w/logs.
set -uo pipefail
bash /src/docs/bench/lexp/scripts/sync.sh >/dev/null
mkdir -p /w/logs
cd /w/repo
npm run typecheck > /w/logs/typecheck.log 2>&1; echo "typecheck exit $?"
npm run build > /w/logs/build.log 2>&1; echo "build exit $?"
NO_COLOR=1 npx vitest run > /w/logs/full.log 2>&1; echo "test exit $?"
grep -E "Test Files|Tests |FAIL " /w/logs/full.log | head -30
