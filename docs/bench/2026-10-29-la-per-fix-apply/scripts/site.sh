#!/bin/sh
# The site checks for #204's wording: build, npm test, the whole Playwright + axe e2e suite as CI runs it, the
# 320/1280 px check (widths.spec.ts) and screenshots of every page at 320, 390 and 1280 px. Runs in the Playwright
# image; /w has no .git, so a throwaway repository of the same files stands in for it (the site build reads Git).
set -u
sh /scripts/sync.sh
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version)"
npm ci --no-audit --no-fund >/tmp/ci.log 2>&1; echo "npm ci exit $?"
git init -q && git add -A && git -c user.name=la -c user.email=la@example.invalid commit -qm stand-in && echo "stand-in repository: $(git ls-files | wc -l) files"
echo "== npm run typecheck"; npm run typecheck >/tmp/typecheck.log 2>&1; echo "typecheck exit $?"; tail -3 /tmp/typecheck.log
echo "== npm run build"; npm run build >/tmp/build.log 2>&1; echo "build exit $?"; tail -3 /tmp/build.log
echo "== npm test"; NO_COLOR=1 npm test >/tmp/test.log 2>&1; echo "npm test exit $?"; grep -E "Test Files|Tests |FAIL" /tmp/test.log | head -20
echo "== npm run test:e2e (CI=1)"; CI=1 npm run test:e2e >/tmp/e2e.log 2>&1; echo "e2e exit $?"; grep -E "passed|failed|skipped|flaky|✘" /tmp/e2e.log | tail -20
cp /scripts/widths.spec.ts e2e/la-widths.spec.ts
echo "== widths (320, 1280)"; CI=1 npx playwright test la-widths --reporter=list >/tmp/widths.log 2>&1; echo "widths exit $?"; grep -E "scrollWidth|apply-|passed|failed" /tmp/widths.log
rm -f e2e/la-widths.spec.ts; rm -rf /out/shots; mkdir -p /out/shots
echo "== screenshots"; CI=1 SCREENSHOTS_DIR=/out/shots npx playwright test screenshots --reporter=list >/tmp/shots.log 2>&1; echo "screenshots exit $?"; ls /out/shots | grep -c png
rm -rf /w/.git
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
