#!/bin/sh
# Runs inside the container on a copy of /w: one mutant at a time, action.test.ts only.
set -u
run() { name=$1; shift; rm -rf /tmp/m && cp -a /w /tmp/m && cd /tmp/m && "$@" && npx vitest run --project node packages/cli/test/action.test.ts > /tmp/out.txt 2>&1; code=$?; t=$(grep -E "Tests " /tmp/out.txt | tr -d '\033' | sed 's/\[[0-9;]*m//g'); echo "$name: exit $code; $t"; cd /; }
run baseline true
run read-guard-off sed -i 's#\*//\*|\*/\./\*|\*/\.\./\*)#__never__)#' action/read.sh
run read-cntrl-kept sed -i 's#${file//\[\[:cntrl:\]\]/}#${file}#' action/read.sh
run judge-guard-off sed -i 's#\*//\*|\*/\./\*|\*/\.\./\*) echo#__never__) echo#' .github/workflows/judge.yml
run judge-cntrl-kept sed -i 's#${file//\[\[:cntrl:\]\]/}#${file}#' .github/workflows/judge.yml
