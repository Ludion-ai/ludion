#!/bin/sh
# The two checks that need git (apps/site/test/knowledge.test.ts and the site build), in node:24-slim with git added.
# /w is a copy of the worktree without .git, so a throwaway repository of the same files stands in for it.
set -u
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version)"
git init -q && git add -A && git -c user.name=l9 -c user.email=l9@localhost commit -qm stand-in && echo "stand-in repository: $(git ls-files | wc -l) files"
echo "== npx vitest run --project node apps/site/test/knowledge.test.ts"; NO_COLOR=1 npx vitest run --project node apps/site/test/knowledge.test.ts >/tmp/site-test.log 2>&1; echo "vitest exit $?"; tail -6 /tmp/site-test.log
echo "== npm run build"; npm run build >/tmp/build.log 2>&1; echo "build exit $?"; tail -4 /tmp/build.log
rm -rf /w/.git
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
