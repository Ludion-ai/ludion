#!/bin/bash
cd /w
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
npm run typecheck >/tmp/tc.log 2>&1; echo "typecheck exit=$?"
npx vitest run --project node packages/cli/test/judge-workflow.test.ts 2>&1 | strip | grep -E "✓|×|Tests|Test Files" | grep -E "protected-paths|Tests|Test Files|×"
npx vitest run --project node packages 2>&1 | strip | grep -E "^\s*(Tests|Test Files)"
f=.github/workflows/protected-paths.yml
mut() { cp $f /tmp/o; perl -0pi -e "$2" $f; cmp -s $f /tmp/o && { echo "NOT APPLIED | $1"; return; }; echo "$1 | $(npx vitest run --project node packages/cli/test/judge-workflow.test.ts 2>&1 | strip | grep -E '^\s*Tests' )"; cp /tmp/o $f; }
mut 'every comment counted (old filter)' 's/--jq "\$APPROVING"/--jq ".[].body"/'
mut 'REQUEST not excluded' 's/ and \(test\("REQUEST"\) \| not\)//'
mut 'APPROVE anywhere in the body' 's/split\(.{4}\)\[0\] \| //'
echo "restored | $(npx vitest run --project node packages/cli/test/judge-workflow.test.ts 2>&1 | strip | grep -E '^\s*Tests')"
