#!/usr/bin/env bash
# Typecheck, the shadow's tests (recorder and replay), and deliberate mutations of the replay, each run in Docker with
# no network (node:24-slim pinned by digest, read-only root, user 1000). Each mutation must make a test fail; the file
# is restored after each. Run from the repository root with a Linux node_modules volume:
#   bash docs/bench/2026-10-29-shadow-replay/scripts/check.sh ludion-lsr-nm > docs/bench/2026-10-29-shadow-replay/logs/check.log 2>&1
set -u
export MSYS_NO_PATHCONV=1
NM="$1"
W=$(pwd -W 2>/dev/null || pwd)
IMAGE=node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
R=tools/shadow/src/replay.ts
D=tools/shadow/src/disputed.ts
run() { docker run --rm --network none --read-only --tmpfs /tmp:exec --user 1000:1000 -e HOME=/tmp -v "$W:/w:ro" -v "$NM:/w/node_modules" -w /w "$IMAGE" sh -c "$1"; }
echo "commit: $(git rev-parse HEAD)  replay.ts blob: $(git hash-object $R)  disputed.ts blob: $(git hash-object $D)  test blob: $(git hash-object tools/shadow/test/replay.test.ts)"
echo "== typecheck"; run "npx tsc -p tsconfig.json; echo tsc_exit=\$?"
echo "== tests"; run "npx vitest run tools/shadow 2>&1 | grep -E 'Tests |Test Files |✓|×'"
mutate() {
  local file="$1"; shift
  echo "== mutation: $1"
  cp "$file" "$file.orig"
  node -e "const fs=require('fs');const s=fs.readFileSync('$file','utf8');const t=s.replace(process.argv[1],process.argv[2]);if(t===s)process.exit(3);fs.writeFileSync('$file',t)" "$2" "$3" || { echo "mutation not applied"; rm "$file.orig"; return; }
  run "npx vitest run tools/shadow 2>&1 | grep -E 'Tests '"
  mv "$file.orig" "$file"
}
mutate $R "MAL- re-query sees every record, whenever published" 'records.filter(r => ms(r.published) <= t &&' 'records.filter(r => true &&'
mutate $R "synthetic fix never exploited" 'kev: row === "exploited"' 'kev: false'
mutate $R "no recomputation of wait_until" 'while (j.wait_until && Date.parse(j.wait_until) !== at && iterations < 20)' 'while (false)'
mutate $R "missing attestations not a gap" 'if ("gap" in cap.provenance) return' 'if (false) return'
mutate $R "a day without a poll does not break the run" 'if (days.has(dayOf(d))) continue;' 'continue;'
mutate $R "false-report candidates counted as misses" 'counts_as_malicious: category !== "false_report"' 'counts_as_malicious: true'
mutate $R "repeated records kept" 'if (previous.get(stream) === key)' 'if (false)'
mutate $R "records after the window's end + 336h join the denominator" 'ms(r.published) <= end + LATE_RECORD_MS' 'true'
mutate $R "nothing pending past the store's coverage" 'if (at > ctx.coverage) return' 'if (false) return'
mutate $R "no seed from a later complete capture" 'if (!("gap" in input)) break;' 'break;'
mutate $R "MAL- records read as they are today" 'if (m <= t && m >= at)' 'if (m >= at)'
mutate $R "withdrawn records leave the denominator" 'const due = records.filter(r => recs.has(r.id) && ms(r.published) <= end + LATE_RECORD_MS)' 'const due = records.filter(r => recs.has(r.id) && !r.withdrawn && ms(r.published) <= end + LATE_RECORD_MS)'
mutate $R "final without an OSV read past the deadline" 'if (window.end && !(lastOsv >= end + LATE_RECORD_MS + OSV_MARGIN_MS))' 'if (false)'
mutate $R "no predecessor is not applicable" 'outcome: "capture_gap", gap: "a missing predecessor' 'outcome: "not_applicable", gap: "a missing predecessor'
mutate $R "met with no case when every case is a false-report candidate" 'cases.length ? "met"' 'counted.length ? "met"'
mutate $R "a version with no stored publish time is skipped offline" 'const read = input.sources ? await input.sources.publishTime(name, version) : "unreadable";' 'if (!input.sources) continue; const read = await input.sources.publishTime(name, version);'
mutate $D "file list only from the last capture" '[...caps].reverse().find(c => c.files)?.files ?? null' 'cap?.files ?? null'
mutate $D "recorder's file list not compared" 'if (captured?.files) {' 'if (false) {'
mutate $D "O after another named version ignored" 'afterNamed || addsScript ?' 'addsScript ?'
mutate $D "added install script ignored" 'afterNamed || addsScript ?' 'afterNamed ?'
git diff --quiet -- $R $D && echo "replay.ts and disputed.ts restored"
