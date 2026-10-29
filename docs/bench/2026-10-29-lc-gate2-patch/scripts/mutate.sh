#!/bin/sh
# Each mutation on a fresh copy of the source in /w; the listed tests must fail.
cd /w
try() {
  name="$1"; file="$2"; from="$3"; to="$4"
  sh /s/sync.sh
  node /s/replace.mjs "$file" "$from" "$to" || { echo "MUTATION NOT APPLIED: $name"; return; }
  if npx vitest run packages/cli/test/candidate-judge.test.ts packages/cli/test/dependencies.test.ts >/tmp/out.txt 2>&1; then echo "SURVIVED: $name"; else echo "caught: $name ($(grep -o '[0-9]* failed' /tmp/out.txt | tail -1))"; fi
}
try "no call in patch" packages/cli/src/security/dependency-patch.ts 'const refusal = candidateRefusal(receipt.judgement = await judgeNpmCandidate(source, exported, deps.fetchFn)); active();' 'const refusal = null as string | null;'
try "wait lets through" packages/cli/src/security/candidate-judge.ts 'if (j.verdict === "ready_except_build") return null;' 'if (j.verdict === "ready_except_build" || j.verdict === "wait") return null;'
try "only the fix judged" packages/cli/src/security/candidate-judge.ts 'const changes = lock.changes.map(c => ({ ...c, dev: false }));' 'const changes = lock.changes.filter(c => c.name === "lodash").map(c => ({ ...c, dev: false }));'
try "lockfile dev kept" packages/cli/src/security/candidate-judge.ts 'const changes = lock.changes.map(c => ({ ...c, dev: false }));' 'const changes = lock.changes;'
try "lookup errors dropped" packages/cli/src/security/candidate-judge.ts 'errors = [error instanceof Error ? error.message : String(error)]; facts = new Map();' 'facts = new Map();'
try "undecidable passes" packages/cli/src/security/candidate-judge.ts 'if (j.verdict === "ready_except_build") return null;' 'if (j.verdict !== "stop" && j.verdict !== "wait") return null;'
try "manifest dropped" packages/cli/src/security/candidate-judge.ts 'judge({ ...lock, changes,' 'judge({ ...lock, manifest: undefined, changes,'
try "links dropped" packages/cli/src/security/candidate-judge.ts 'judge({ ...lock, changes,' 'judge({ ...lock, links: [], changes,'
try "entries dropped" packages/cli/src/security/candidate-judge.ts 'judge({ ...lock, changes,' 'judge({ ...lock, entries: undefined, changes,'
try "extend reasons dropped" packages/cli/src/security/candidate-judge.ts '${extended.length ?' '${false ?'
try "judge exception swallowed" packages/cli/src/security/dependency-patch.ts 'const refusal = candidateRefusal(receipt.judgement = await judgeNpmCandidate(source, exported, deps.fetchFn)); active();' 'let refusal: string | null = null; try { refusal = candidateRefusal(receipt.judgement = await judgeNpmCandidate(source, exported, deps.fetchFn)); } catch {} active();'
try "extraneous dropped" packages/cli/src/security/candidate-judge.ts 'judge({ ...lock, changes,' 'judge({ ...lock, extraneous: [], changes,'
try "undecidable without stop passes" packages/cli/src/security/candidate-judge.ts 'if (j.verdict === "ready_except_build") return null;' 'if (j.verdict === "ready_except_build" || (j.verdict === "undecidable" && !j.findings.some(f => f.effect === "stop"))) return null;'
# LC3 (2026-10-29), from the review of 829ef97: two changes no test caught then.
try "refusal only with --apply" packages/cli/src/security/dependency-patch.ts 'if (refusal) throw new Error(refusal);' 'if (refusal && apply) throw new Error(refusal);'
try "removed extraneous folders dropped" packages/cli/src/security/judge-cli.ts ', ...extraneousBefore.filter(e => !extraneousAfter.includes(e)).map(e => `(removed) ${e}`)]' ']'
# LC3: the wait extension when the replaced version is no longer listed (README, docs/status.md).
try "unlisted replaced version not extended" packages/cli/src/security/judge.ts 'extended = true; comparable = false;' 'extended ||= !prev; comparable = false;'
# LC3: EPSS from the whole list, not from api.first.org; a fake that answered only api.first.org would fail.
try "EPSS asked of api.first.org" packages/cli/src/security/npm-facts.ts 'let res = await fetchFn(EPSS_LIST, init);' 'let res = await fetchFn(`https://api.first.org/data/v1/epss?cve=${cves.join(",")}`, init);'
