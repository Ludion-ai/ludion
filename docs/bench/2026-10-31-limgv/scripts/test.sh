#!/bin/sh
# Sync the worktree into /w, typecheck, then vitest (node project) with two workers and any args.
set -u
sh /scripts/sync.sh
cd /w
git init -q && git add -A && git -c user.name=t -c user.email=t@example.invalid commit -qm stand-in
echo "== tsc"; npx tsc -p tsconfig.json; echo "tsc exit $?"
echo "== vitest $*"; NO_COLOR=1 npx vitest run --project node --maxWorkers=2 "$@" >/tmp/t.log 2>&1; echo "vitest exit $?"
grep -E "^ +(×|FAIL) |Test Files|Tests |AssertionError|Expected|Received|^ +[-+] " /tmp/t.log | head -${LINES_MAX:-150}
