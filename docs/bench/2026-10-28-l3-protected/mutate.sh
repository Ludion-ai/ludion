#!/bin/bash
# Runs one mutation at a time against judge-workflow.test.ts and restores the file after each.
cd /w
run() { # name file perl-expression
  local name="$1" file="$2" expr="$3"
  cp "$file" /tmp/orig
  perl -0pi -e "$expr" "$file"
  if cmp -s "$file" /tmp/orig; then echo "NOT APPLIED | $name"; return; fi
  out=$(npx vitest run --project node packages/cli/test/judge-workflow.test.ts 2>&1 | grep -E "^\s*(.\[[0-9;]*m)*\s*Tests" | tail -1 | sed 's/\x1b\[[0-9;]*m//g')
  cp /tmp/orig "$file"
  echo "$name | $out"
}
J=.github/workflows/judge.yml; C=.github/workflows/judge-comment.yml; R=.github/judge/record.ts
run 'checkout "$HEAD_SHA" before build' $J 's/git checkout --quiet --detach "\$base"/git checkout --quiet --detach "\$HEAD_SHA"/'
run 'checkout "$MERGE_SHA" before build' $J 's/git checkout --quiet --detach "\$base"/git checkout --quiet --detach "\$MERGE_SHA"/'
run 'checkout refs/ludion/merge before build' $J 's/git checkout --quiet --detach "\$base"/git checkout --quiet --detach refs\/ludion\/merge/'
run 'base fetch of ${HEAD_SHA}' $J 's/\+refs\/heads\/\$\{BASE_REF\}:refs\/ludion\/base/+\$\{HEAD_SHA\}:refs\/ludion\/base/'
run 'stop-commands line removed' $R 's/  log\(`::stop-commands::\$\{token\}`\);\n//'
run 'judge.ts imported up front' $R 's/import type \{ Judgement \} from/import { type Judgement, renderJudgement as _eager } from/'
run 'refused head reads the artifact' $C 's/if \[ "\$refused" = "true" \]; then/if false; then/'
run 'record PR and head not compared' $C 's/if \[ "\$recorded" != "\$\{pr\} \$\{RUN_HEAD\}" \]; then/if false; then/'
npx vitest run --project node packages/cli/test/judge-workflow.test.ts 2>&1 | grep -E "Tests" | tail -1 | sed 's/\x1b\[[0-9;]*m//g' | sed 's/^/restored | /'
