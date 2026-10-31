#!/bin/sh
# No network: in /w as ci.sh left it, the repository's own scripts: npm run build, npm run typecheck, npm test (every
# vitest project, the worker's included, which needs the site's build) with two workers. LNODE3; copied for LPHPV.
set -u
echo "# at commit ${LN_HEAD:-unknown}, ${LN_DIRTY:-unknown} files differing from it"
d=$(diff -rq --exclude=node_modules --exclude=.git --exclude=dist --exclude=.astro /src /w | wc -l); echo "# /w differs from /src in $d entries"
cd /w
[ -d .git ] || { git init -q && git add -A && git -c user.name=t -c user.email=t@example.invalid commit -qm stand-in; echo "# stand-in repository made in /w"; }
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version)"
echo "== npm run build"; npm run build >/tmp/build.log 2>&1; echo "build exit $?"; tail -3 /tmp/build.log
echo "== npm run typecheck"; npm run typecheck; echo "typecheck exit $?"
echo "== npm test -- --maxWorkers=2"; NO_COLOR=1 npm test -- --maxWorkers=2; echo "test exit $?"
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
