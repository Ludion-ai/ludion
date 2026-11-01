#!/usr/bin/env bash
# Inside the container, no network: one mutation per check of definitions.md, section 7 (GitHub's clock), each alone,
# on the four test files. The tally goes to /w/logs/mutate5.log.
set -uo pipefail
D=packages/cli/src/security/deliver.ts
TESTS="packages/cli/test/exposure.test.ts packages/cli/test/deliver.test.ts packages/cli/test/check.test.ts packages/cli/test/action-patch.test.ts"
mkdir -p /w/logs
: > /w/logs/mutate5.log
m() {
  local name=$1 file=$2 from=$3 to=$4
  bash /src/docs/bench/lexp/scripts/sync.sh >/dev/null
  cd /w/repo
  local n
  n=$(FROM="$from" perl -0ne 'BEGIN { $f = $ENV{FROM} } while (($i = index($_, $f, $i // 0)) >= 0) { $n++; $i++ } END { print $n // 0 }' "$file")
  if [ "$n" != 1 ]; then echo "$name NOT APPLIED ($n matches)" | tee -a /w/logs/mutate5.log; return; fi
  FROM="$from" TO="$to" perl -0pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  if NO_COLOR=1 npx vitest run $TESTS > "/w/logs/mut5-$name.log" 2>&1; then echo "$name SURVIVED" | tee -a /w/logs/mutate5.log
  else echo "$name caught ($(grep -cE '^ +(FAIL|×)' "/w/logs/mut5-$name.log") failing lines)" | tee -a /w/logs/mutate5.log; fi
}
# This run's own start against the runner's clock and against the Date of its answer.
m H1-own-clock $D 'if (ownAt > clock) throw' 'if (false && ownAt > clock) throw'
m H2-own-date $D 'if (pastAnswer(ownAt, own.date)) throw' 'if (false) throw'
# A record's time outside its run: passed over in silence again (the code before), early and late apart.
m H3-early-silent $D 'if (at < started) return { kind: "early", ms: started - at };' 'if (at < started) return null;'
m H4-late-silent $D 'if (at > uploaded) return { kind: "late", ms: at - uploaded };' 'if (at > uploaded) return null;'
# A run whose times do not agree is passed over instead of stopping the walk.
m H5-pass-over $D 'if ("kind" in record) { stopped =' 'if ("kind" in record) continue; if (false) { stopped ='
# GitHub's start of an earlier run, or its artifact's upload, later than the Date of the answer that gives it.
m H6-start-ahead $D 'if (startAhead) return' 'if (false) return'
m H7-upload-ahead $D 'if (uploadAhead) return' 'if (false) return'
# No Date header is ever read, or one hour of margin instead of one second.
m H8-no-date $D 'return Number.isFinite(ms) && new Date(ms).toUTCString() === value ? ms : null;' 'return null;'
m H9-hour-margin $D 'at - date >= 1000 ?' 'at - date >= 3_600_000 ?'
# merged_at against the Date of its answer and against this job's clock; the hours computed despite a doubt.
m H10-merged-date $D 'const doubt = pastDate ?' 'const doubt = false ?'
m H11-merged-clock $D ': merged > ran ? `GitHub' ': false ? `GitHub'
m H12-hours-anyway $D 'doubt !== null ? `not computed: ${doubt}` : hours(record.fix_published_at, end,' 'false ? "" : hours(record.fix_published_at, record.merged_at,'
# The Found row's words: none, or not given to the fix; every fix gets it, ended or not.
m H13-row-silent $D 'const stop = !s.stop ? ""' 'const stop = true ? ""'
m H14-not-passed $D 'w.stopped?.branches.includes(fix.branch) ?' 'false ?'
m H15-every-fix $D 'fixes.filter(f => !state.get(f.branch)!.ended).map(f => f.branch)' 'fixes.map(f => f.branch)'
echo done
