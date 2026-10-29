#!/bin/sh
# The checks that need git (apps/site/test/knowledge.test.ts, packages/cli/test/action.test.ts and the site build), in
# node:24-slim with git added (image ludion-l9-node24-git, L9's). /w is a copy of the worktree without .git, so a throwaway
# repository of the same files stands in for it.
set -u
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version), HEAD $(cat /s/HEAD 2>/dev/null || echo unknown)"
git init -q && git add -A && git -c user.name=l9b -c user.email=l9b@localhost commit -qm stand-in && echo "stand-in repository: $(git ls-files | wc -l) files"
echo "== npx vitest run --project node apps/site/test/knowledge.test.ts packages/cli/test/action.test.ts"; NO_COLOR=1 npx vitest run --project node apps/site/test/knowledge.test.ts packages/cli/test/action.test.ts >/tmp/git-test.log 2>&1; echo "vitest exit $?"; tail -8 /tmp/git-test.log
echo "== npm run build"; npm run build >/tmp/build.log 2>&1; echo "build exit $?"; tail -4 /tmp/build.log
rm -rf /w/.git
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
