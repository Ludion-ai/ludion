#!/bin/sh
# CI's checks except the Playwright e2e: typecheck, build, npm test (network none, node_modules from setup.sh). /w has
# no .git, so a throwaway repository of the same files (without node_modules and the OSV zips) stands in for it (the
# site build and two tests read Git). As LV5's full.sh.
set -u
sh /scripts/sync.sh
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version)"
git init -q && echo "osv/" >> .git/info/exclude && git add -A && git -c user.name=lmr1 -c user.email=lmr1@example.invalid commit -qm stand-in && echo "stand-in repository: $(git ls-files | wc -l) files"
echo "== npm run typecheck"; npm run typecheck >/tmp/typecheck.log 2>&1; echo "typecheck exit $?"; tail -3 /tmp/typecheck.log
echo "== npm run build"; npm run build >/tmp/build.log 2>&1; echo "build exit $?"; tail -3 /tmp/build.log
echo "== npm test -- --maxWorkers=2"; NO_COLOR=1 npm test -- --maxWorkers=2 >/tmp/test.log 2>&1; echo "npm test exit $?"; grep -E "Test Files|Tests |FAIL" /tmp/test.log | head -20
rm -rf /w/.git
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
