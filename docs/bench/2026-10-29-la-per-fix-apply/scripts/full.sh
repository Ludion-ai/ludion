#!/bin/sh
# CI's checks except the Playwright e2e: typecheck, build, npm test. /w has no .git, so a throwaway repository of the
# same files stands in for it (the site build and two tests read Git).
set -u
sh /scripts/sync.sh
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version)"
npm ci --no-audit --no-fund >/tmp/ci.log 2>&1; echo "npm ci exit $?"
git init -q && git add -A && git -c user.name=la -c user.email=la@example.invalid commit -qm stand-in && echo "stand-in repository: $(git ls-files | wc -l) files"
echo "== npm run typecheck"; npm run typecheck >/tmp/typecheck.log 2>&1; echo "typecheck exit $?"; tail -3 /tmp/typecheck.log
echo "== npm run build"; npm run build >/tmp/build.log 2>&1; echo "build exit $?"; tail -3 /tmp/build.log
echo "== npm test"; NO_COLOR=1 npm test >/tmp/test.log 2>&1; echo "npm test exit $?"; grep -E "Test Files|Tests |FAIL" /tmp/test.log | head -20
rm -rf /w/.git
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
