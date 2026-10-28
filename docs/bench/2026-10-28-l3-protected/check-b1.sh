#!/bin/bash
# Typecheck, tests, then mutations of protected-paths.yml one at a time (each restored), in a copy of the tree at /w.
cd /w
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
tests() { npx vitest run --project node packages/cli/test/judge-workflow.test.ts 2>&1 | strip | grep -E '^\s*Tests'; }
npm run typecheck >/tmp/tc.log 2>&1; echo "typecheck exit=$?"
npx vitest run --project node packages/cli/test/judge-workflow.test.ts 2>&1 | strip | grep -E "^\s*(Tests|Test Files)|×"
npx vitest run --project node packages 2>&1 | strip | grep -E "^\s*(Tests|Test Files)"
f=.github/workflows/protected-paths.yml
mut() { cp $f /tmp/o; perl -0pi -e "$2" $f; cmp -s $f /tmp/o && { echo "NOT APPLIED | $1"; return; }; echo "$1 | $(tests)"; cp /tmp/o $f; }
mut 'every review counted as approving' 's/then "approve" else "other" end/then "approve" else "approve" end/'
mut 'REQUEST not excluded' 's/ and \(test\("REQUEST"\) \| not\)//'
mut 'APPROVE anywhere in the comment' 's/\$lines\[0\] \| test/(\$lines | join(" ")) | test/'
mut 'the first review of the head decides' 's/\$2 == head \{ verdict = \$1 \}/\$2 == head \&\& verdict == "" { verdict = \$1 }/'
mut 'any approval of the head counts' 's/\$2 == head \{ verdict = \$1 \}/\$2 == head \&\& \$1 == "approve" { verdict = \$1 }/'
echo "restored | $(tests)"
