#!/usr/bin/env bash
# Inside the container, no network: the review's Q6 and Q9 (R252b N10, N11), which survived at 620aeae, and one mutation
# per fix of R252b's N9 and N13, each alone, on the four test files. The tally goes to /w/logs/mutate4.log.
set -uo pipefail
D=packages/cli/src/security/deliver.ts
TESTS="packages/cli/test/exposure.test.ts packages/cli/test/deliver.test.ts packages/cli/test/check.test.ts packages/cli/test/action-patch.test.ts"
mkdir -p /w/logs
: > /w/logs/mutate4.log
m() {
  local name=$1 file=$2 from=$3 to=$4
  bash /src/docs/bench/lexp/scripts/sync.sh >/dev/null
  cd /w/repo
  local n
  n=$(FROM="$from" perl -0ne 'BEGIN { $f = $ENV{FROM} } while (($i = index($_, $f, $i // 0)) >= 0) { $n++; $i++ } END { print $n // 0 }' "$file")
  if [ "$n" != 1 ]; then echo "$name NOT APPLIED ($n matches)" | tee -a /w/logs/mutate4.log; return; fi
  FROM="$from" TO="$to" perl -0pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  if NO_COLOR=1 npx vitest run $TESTS > "/w/logs/mut4-$name.log" 2>&1; then echo "$name SURVIVED" | tee -a /w/logs/mutate4.log
  else echo "$name caught ($(grep -cE '^ +(FAIL|×)' "/w/logs/mut4-$name.log") failing lines)" | tee -a /w/logs/mutate4.log; fi
}
# The review's two survivors.
m Q6-page-limit $D $'    inTime();\n    const query' '    const query'
m Q9-inflate-limit $D 'inflateRawSync(body, { maxOutputLength: max })' 'inflateRawSync(body)'
# N9: the old check (Date.parse finite) everywhere, then at each of the three places alone, then the milliseconds.
m G1-old-check $D 'const isDate = (t: string) => {' 'const isDate = (t: string) => Number.isFinite(Date.parse(t)); const unused = (t: string) => {'
m G2-seen-checked-at $D '!isDate(checked) || ' ''
m G3-body-time $D 'TIME.test(m[1]!) && isDate(m[1]!)' 'TIME.test(m[1]!) && Number.isFinite(Date.parse(m[1]!))'
m G4-merged-at $D '!isDate(p.merged_at)' '!Number.isFinite(Date.parse(p.merged_at))'
m G5-milliseconds $D '(f ?? "").padEnd(3, "0")' '(f ?? "000")'
# N13: the old words.
m G6-not-used $D "earlier runs' records were not used: " "earlier runs' records were not read: "
echo done
