#!/bin/sh
sh /s/sync.sh
cd /w
# A stand-in repository: the site's build and some tests read git.
rm -rf .git && git init -q && git add -A && git -c user.email=lc@example.invalid -c user.name=lc commit -qm stand-in
echo "== typecheck"; npm run typecheck >/tmp/tc.txt 2>&1; echo "typecheck exit $?"; tail -5 /tmp/tc.txt | grep -v "npm notice"
echo "== build"; npm run build >/tmp/b.txt 2>&1; echo "build exit $?"; ls -l packages/cli/dist/cli.js
echo "== vitest"; npx vitest run >/tmp/v.txt 2>&1; echo "vitest exit $?"; grep -E "FAIL|Test Files|Tests " /tmp/v.txt | tail -30
