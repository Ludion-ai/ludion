#!/usr/bin/env bash
# Inside the container, no network: the five mutations mutate.sh left alive, again, after the tests were made stronger
# (M6, M7, M23, M24) and M22 was aimed at the merged mode's check (mutate.sh's text matched the judge mode's first).
# Pass the names to run; the tally goes to /w/logs/mutate2.log.
set -uo pipefail
D=packages/cli/src/security/deliver.ts
TESTS="packages/cli/test/exposure.test.ts packages/cli/test/deliver.test.ts packages/cli/test/check.test.ts packages/cli/test/action-patch.test.ts"
touch /w/logs/mutate2.log
m() {
  local name=$1 file=$2 from=$3 to=$4
  case " $SELECT " in *" $name "*) ;; *) return ;; esac
  bash /src/docs/bench/lexp/scripts/sync.sh >/dev/null
  cd /w/repo
  if ! FROM="$from" perl -0ne 'BEGIN { $f = $ENV{FROM} } $n++ if index($_, $f) >= 0; END { exit($n ? 0 : 1) }' "$file"; then echo "$name NOT APPLIED" | tee -a /w/logs/mutate2.log; return; fi
  FROM="$from" TO="$to" perl -0pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  if NO_COLOR=1 npx vitest run $TESTS > "/w/logs/mut2-$name.log" 2>&1; then echo "$name SURVIVED" | tee -a /w/logs/mutate2.log
  else echo "$name caught ($(grep -cE '^ +(FAIL|×)' "/w/logs/mut2-$name.log") failing lines)" | tee -a /w/logs/mutate2.log; fi
}
SELECT="$*"
m M6-advisory-match $D 'return !!key && key.advisories.some(a => ids.has(a));' 'return !!key;'
m M7-limit $D 'runs.sort((a, b) => b.id - a.id).splice(limit);' 'runs.sort((a, b) => b.id - a.id);'
m M22b-start-merged-event action/start.sh $'if [ "$EVENT" != "pull_request" ]; then\n      echo "::error::mode merged' $'if false; then\n      echo "::error::mode merged'
m M23-zip-size $D 'return out && out.length === length ? Buffer.from(out) : null;' 'return out ? Buffer.from(out) : null;'
m M24-bounded $D 'if (total > max) { await reader.cancel(); return null; }' ''
echo done
