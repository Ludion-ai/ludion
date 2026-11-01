#!/usr/bin/env bash
# Inside the container, no network: the review's R4 and R5 (R252 N1, N2), which survived at b5097c2, and one mutation per
# fix of R252's B1, N3, N4 and N7, each alone, on the four test files. The tally goes to /w/logs/mutate3.log.
set -uo pipefail
D=packages/cli/src/security/deliver.ts
TESTS="packages/cli/test/exposure.test.ts packages/cli/test/deliver.test.ts packages/cli/test/check.test.ts packages/cli/test/action-patch.test.ts"
mkdir -p /w/logs
: > /w/logs/mutate3.log
m() {
  local name=$1 file=$2 from=$3 to=$4
  bash /src/docs/bench/lexp/scripts/sync.sh >/dev/null
  cd /w/repo
  local n
  n=$(FROM="$from" perl -0ne 'BEGIN { $f = $ENV{FROM} } while (($i = index($_, $f, $i // 0)) >= 0) { $n++; $i++ } END { print $n // 0 }' "$file")
  if [ "$n" != 1 ]; then echo "$name NOT APPLIED ($n matches)" | tee -a /w/logs/mutate3.log; return; fi
  FROM="$from" TO="$to" perl -0pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  if NO_COLOR=1 npx vitest run $TESTS > "/w/logs/mut3-$name.log" 2>&1; then echo "$name SURVIVED" | tee -a /w/logs/mutate3.log
  else echo "$name caught ($(grep -cE '^ +(FAIL|×)' "/w/logs/mut3-$name.log") failing lines)" | tee -a /w/logs/mutate3.log; fi
}
m R4-inflated-limit $D 'const entry = unzipEntry(bytes, "seen.json", SEEN_BYTES);' 'const entry = unzipEntry(bytes, "seen.json", 1024 * 1024 * 1024);'
m R5-receipt-earlier $D 'else if (Date.parse(s.at) <= Date.parse(fix.found_at))' 'else if (true)'
m F1-merged-runner action/start.sh $'if [ "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ]; then\n      echo "::error::mode ${MODE} runs only on GitHub-hosted runners (a fresh machine per job), not on ${RUNNER_ENVIRONMENT:-an unknown runner}."\n      exit 1\n    fi\n    need node' 'need node'
m F2-body-date $D ' && Number.isFinite(Date.parse(m[1]!))' ''
m F3-merged-at-date $D ' || !Number.isFinite(Date.parse(p.merged_at))' ''
m F4-earliest $D '{ if (!s.found || Date.parse(record.checked_at) < Date.parse(s.found.at)) s.found = { at: record.checked_at, run: run.id }; }' 's.found = { at: record.checked_at, run: run.id };'
m F5-walk-limit $D 'if (now() > until) throw' 'if (false) throw'
m F6-walk-limit-per-run $D $'    inTime();\n    const record' '    const record'
echo done
