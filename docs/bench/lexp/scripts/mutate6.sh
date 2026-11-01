#!/usr/bin/env bash
# Inside the container, no network: one mutation per time the Found row keeps (definitions.md, section 8), each alone,
# on the two test files that hold them. The tally goes to /w/logs/mutate6.log.
set -uo pipefail
D=packages/cli/src/security/deliver.ts
TESTS="packages/cli/test/exposure.test.ts packages/cli/test/deliver.test.ts"
mkdir -p /w/logs
: > /w/logs/mutate6.log
m() {
  local name=$1 file=$2 from=$3 to=$4
  # ONLY=<name>: that mutation alone.
  if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ]; then return; fi
  bash /src/docs/bench/lexp/scripts/sync.sh >/dev/null
  cd /w/repo
  local n
  n=$(FROM="$from" perl -0ne 'BEGIN { $f = $ENV{FROM} } while (($i = index($_, $f, $i // 0)) >= 0) { $n++; $i++ } END { print $n // 0 }' "$file")
  if [ "$n" != 1 ]; then echo "$name NOT APPLIED ($n matches)" | tee -a /w/logs/mutate6.log; return; fi
  FROM="$from" TO="$to" perl -0pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  if NO_COLOR=1 npx vitest run $TESTS > "/w/logs/mut6-$name.log" 2>&1; then echo "$name SURVIVED" | tee -a /w/logs/mutate6.log
  else echo "$name caught ($(grep -E '^ +Tests ' "/w/logs/mut6-$name.log" | sed 's/ *Tests *//'))" | tee -a /w/logs/mutate6.log; fi
}
# A walk not done: only the difference again, not the times.
m I1-why-clock $D ": GitHub's start \${times.run_started_at}, this runner's clock \${times.runner}.\`" '.`'
m I2-why-date $D ": GitHub's start \${times.run_started_at}, that Date \${times.answer_date}, this runner's clock \${times.runner}.\`" '.`'
# This run's times: the wrong clock, or no Date.
m I3-runner $D 'runner: new Date(clock).toISOString()' 'runner: new Date(ownAt).toISOString()'
m I4-no-date $D 'answer_date: own.date === null ? null : new Date(own.date).toISOString()' 'answer_date: null'
# A run whose times do not agree: the other clock's time written in GitHub's place, or the other way round.
m I5-early $D 'github: new Date(started).toISOString(), other: new Date(at).toISOString()' 'github: new Date(at).toISOString(), other: new Date(at).toISOString()'
m I6-late $D 'github: new Date(uploaded).toISOString(), other: new Date(at).toISOString()' 'github: new Date(at).toISOString(), other: new Date(at).toISOString()'
m I7-start-ahead $D 'github: new Date(run.started).toISOString(), other: new Date(run.dated!).toISOString()' 'github: new Date(run.started).toISOString(), other: new Date(run.started).toISOString()'
m I8-upload-ahead $D 'other: new Date(listed.date!).toISOString()' 'other: new Date(Date.parse(live[0]!.created_at as string)).toISOString()'
# The times do not reach the fix.
m I9-stop-copy $D 'github: w.stopped.github, other: w.stopped.other' 'github: "", other: ""'
m I10-found-started $D 'started: new Date(run.started).toISOString() }; }' 'started: record.checked_at }; }'
m I11-seen-started $D 'run: s.run, started: s.started, read' 'run: s.run, read'
m I12-clock-none $D 'ended: !stop.stop, clock: w.clock, ...stop' 'ended: !stop.stop, ...stop'
m I13-clock-found $D 'ended: s.ended, clock: w.clock, ...stop }; fix.found_at' 'ended: s.ended, ...stop }; fix.found_at'
m I14-clock-earlier $D 'earlier: true, clock: w.clock, ...stop' 'earlier: true, ...stop'
# The Found row leaves them out.
m I15-row-clock $D 'const clock = !s.clock ? ""' 'const clock = true ? ""'
m I16-row-started $D '${s.started ? `, which GitHub says' '${false ? `, which GitHub says'
m I17-row-early $D "its record's time \${code(s.stop.other)} is \${span(s.stop.ms, code)} before" "its record's time is \${span(s.stop.ms, code)} before"
m I18-row-late $D "its record's time \${code(s.stop.other)} is \${span(s.stop.ms, code)} after" "its record's time is \${span(s.stop.ms, code)} after"
m I19-row-ahead $D 'later than the Date ${code(s.stop.other)} of' 'later than the Date of'
echo done
