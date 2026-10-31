#!/bin/sh
# The whole check: build, typecheck and every test, as CI runs them, with two vitest workers.
set -u
sh /scripts/sync.sh
cd /w
git init -q && git add -A && git -c user.name=t -c user.email=t@example.invalid commit -qm stand-in
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version)"
echo "== npm run build"; npm run build >/tmp/build.log 2>&1; echo "build exit $?"; tail -3 /tmp/build.log
echo "== npm run typecheck"; npm run typecheck; echo "typecheck exit $?"
echo "== npm test -- --maxWorkers=2"; NO_COLOR=1 npm test -- --maxWorkers=2 >/tmp/test.log 2>&1; echo "test exit $?"
grep -E "security.test.ts|node-image.test.ts|deliver.test.ts|records.test.ts|Test Files|Tests " /tmp/test.log
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
