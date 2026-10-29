#!/usr/bin/env bash
# Typecheck, the shadow's tests (recorder and replay), and deliberate mutations of the replay, each run in Docker with
# no network (node:24-slim pinned by digest, read-only root, user 1000). Each mutation must make a test fail; the file
# is restored after each. Run from the repository root with a Linux node_modules volume:
#   bash docs/bench/2026-10-29-shadow-replay/scripts/check.sh ludion-lsr-nm [start commit] > docs/bench/2026-10-29-shadow-replay/logs/check.log 2>&1
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
# The count runs the judge's files from the recorder's start commit (run.sh): the tests run against them too.
START=${2:-8a78b55940def8463a2401e7bdd38d7e6c7b604d}
TREE=$(mktemp -d)
mkdir -p "$TREE/node_modules"
git -c core.autocrlf=false archive HEAD | (cd "$TREE" && tar -x)
for f in packages/cli/src/security/judge.ts packages/cli/src/security/npm-facts.ts packages/cli/src/security/time-cap.ts tools/backtest/src/archives-v5.ts; do git -c core.autocrlf=false show "$START:$f" > "$TREE/$f"; echo "  $f from $START: $(git hash-object --stdin < "$TREE/$f")"; done
TW=$(cd "$TREE" && (pwd -W 2>/dev/null || pwd))
# The typecheck covers the shadow's code and what it imports (the start commit's judge files): main's other files may
# import what the start commit's judge does not export, and the count never loads them.
echo '{"extends":"./tsconfig.json","include":["tools/shadow/src","tools/shadow/test"]}' > "$TREE/tsconfig.shadow.json"
echo "== tests with the start commit's judge files"
docker run --rm --network none --read-only --tmpfs /tmp:exec --user 1000:1000 -e HOME=/tmp -v "$TW:/w:ro" -v "$NM:/w/node_modules" -w /w "$IMAGE" sh -c "npx tsc -p tsconfig.shadow.json; echo tsc_exit=\$?; npx vitest run tools/shadow 2>&1 | grep -E 'Tests |Test Files |×'"
rm -rf "$TREE"
mutate() {
  local file="$1"; shift
  echo "== mutation: $1"
  cp "$file" "$file.orig"
  node -e "const fs=require('fs');const s=fs.readFileSync('$file','utf8');const t=s.replace(process.argv[1],process.argv[2]);if(t===s)process.exit(3);fs.writeFileSync('$file',t)" "$2" "$3" || { echo "mutation not applied"; rm "$file.orig"; return; }
  run "npx vitest run tools/shadow 2>&1 | grep -E 'Tests |Test Files '"
  mv "$file.orig" "$file"
}
mutate $R "MAL- re-query sees every record, whenever published" 'if (r && ms(r.published) <= t && !withdrawnBy' 'if (r && !withdrawnBy'
mutate $R "synthetic fix never exploited" 'kev: row === "exploited"' 'kev: false'
mutate $R "no recomputation of wait_until" 'while (j.wait_until && Date.parse(j.wait_until) !== at && iterations < 20)' 'while (false)'
mutate $R "missing attestations not a gap" 'if ("gap" in cap.provenance) return' 'if (false) return'
mutate $R "a day without a poll does not break the run" 'if (days.has(dayOf(d))) continue;' 'continue;'
mutate $R "false-report candidates counted as misses" 'counts_as_malicious: category !== "false_report"' 'counts_as_malicious: true'
mutate $R "repeated records kept" 'if (previous.get(item.stream) === item.key)' 'if (false)'
mutate $R "records after the window's end + 336h join the denominator" 'const due = recs.filter(r => ids.get(r)! <= end + LATE_RECORD_MS);' 'const due = recs;'
mutate $R "nothing pending past the store's coverage" 'if (at > ctx.coverage) return' 'if (false) return'
mutate $R "no seed from a later complete capture" 'if (!("gap" in input)) break;' 'break;'
mutate $R "MAL- records read as they are today" 'if (m <= t && m >= at)' 'if (m >= at)'
mutate $R "withdrawn records leave the denominator" 'const due = recs.filter(r => ids.get(r)! <= end + LATE_RECORD_MS);' 'const due = recs.filter(r => ids.get(r)! <= end + LATE_RECORD_MS && !copies.some(c => c.id === r && c.withdrawn));'
mutate $R "final without an OSV read past the deadline" 'if (window.end && !(lastOsv >= end + LATE_RECORD_MS + OSV_MARGIN_MS))' 'if (false)'
mutate $R "no predecessor is not applicable" 'outcome: "capture_gap", gap: "a missing predecessor' 'outcome: "not_applicable", gap: "a missing predecessor'
mutate $R "met with no case when every case is a false-report candidate" 'cases.length ? "met"' 'counted.length ? "met"'
mutate $R "a version with no stored publish time is skipped offline" 'const times = input.sources ? await registryTime(name) : "unreadable";' 'if (!input.sources) continue; const times = await registryTime(name);'
mutate $R "the denominator from each record's latest copy only" 'const copies = malCopies(store);' 'const copies = [...store.osv.values()].map(c => c.at(-1)!.record).filter(r => r.id.startsWith("MAL-"));'
mutate $R "OSV records still being retried ignored" 'if (retrying.length) notFinal.push' 'if (false) notFinal.push'
mutate $R "ranges enumerated over stored versions only" 'else for (const v of Object.keys(time)) if (semver.valid(v)) candidates.add(v);' 'else void time;'
mutate $R "final although a range was not enumerated" 'if (rangesNotRead.size) notFinal.push' 'if (false) notFinal.push'
mutate $D "withdrawn records left out of the record-omission rule" 'all.some(r => names(r, name, v))' 'records.some(r => names(r, name, v))'
mutate $D "V left out of the run of identical code's times" 'time.set(version, input.published);' 'time.delete(version);'
mutate $R "seeds from V's own captures and P's packument only" '...(captureTimesByName(ctx.store).get(name) ?? []),' '...[],'
mutate $R "OSV not asked by package name" 'else copies.push(...answer.filter(r => typeof r?.id === "string" && r.id.startsWith("MAL-")));' 'else void answer;'
mutate $R "final although OSV was not asked" 'if (osvNotQueried.length) notFinal.push' 'if (false) notFinal.push'
mutate $R "capture gaps of MAL-only cases not listed" 'capture_gaps: [...results, ...cases.filter(c => !results.some(r => r.name === c.name && r.version === c.version))]' 'capture_gaps: [...results]'
mutate $R "no seed from a dependency's later first publish" '...[...deps].flatMap(d => (ctx.store.created.get(d) ?? []).map(c => c.fetched_at)),' '...[],'
mutate $R "inputs past the coverage a gap, not pending" 'if (s > ctx.coverage) return' 'if (false) return'
mutate $D "the recorder's file list not compared by digest" 'if (!captured?.files && captured?.files_digest && captured.files_digest !== filesDigest(' 'if (false && captured?.files_digest !== filesDigest('
mutate $R "OSV asked only for names with a stored window version" '(store.timeline.get(n) ?? []).some(r => r.at >= start && r.at <= asOf) || failedNames.has(n) || ' ''
mutate $R "a copy with no publish time counts as late" 'Number.isFinite(p) ? p : -Infinity' 'p'
mutate $R "the latest poll by spreading every status line" 'const lastPoll = latest("poll"), lastOsv = latest("osv");' 'const lastPoll = Math.max(-Infinity, ...store.status.filter(s => s.type === "poll").map(s => ms(s.at))), lastOsv = latest("osv");'
mutate $R "a version the recorder gave up on judged from its partial capture" 'if (gaveUp) return' 'if (false) return'
mutate $R "captures after V's publish + 336h seed a judgement" 'const last336 = Number.isFinite(published) ? published + LATE_RECORD_MS : Infinity;' 'const last336 = Infinity;'
mutate $R "a range record with no publish time not expanded" '&& !(ms(r.published) > end + LATE_RECORD_MS)) {' '&& ms(r.published) <= end + LATE_RECORD_MS) {'
mutate $R "the re-query stops on a range it cannot place" '!withdrawnBy(r, t) && namesPlaced(r, name, version)' '!withdrawnBy(r, t) && names(r, name, version)'
mutate $D "file list only from the last capture" 'const hashed = [...caps].reverse().find(c => c.files || c.files_digest);' 'const hashed = caps.at(-1);'
mutate $D "recorder's file list not compared" 'if (captured?.files) {' 'if (false) {'
mutate $D "O after another named version ignored" 'afterNamed || addsScript ?' 'addsScript ?'
mutate $D "added install script ignored" 'afterNamed || addsScript ?' 'afterNamed ?'
git diff --quiet -- $R $D && echo "replay.ts and disputed.ts restored"
