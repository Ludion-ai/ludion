#!/usr/bin/env bash
# Inside the container, no network: each mutation is applied alone to a fresh copy, and the LEXP tests must fail on it.
# A mutation whose text is not found is reported as NOT APPLIED. The tally goes to /w/logs/mutate.log.
set -uo pipefail
D=packages/cli/src/security/deliver.ts C=packages/cli/src/security/check.ts
TESTS="packages/cli/test/exposure.test.ts packages/cli/test/deliver.test.ts packages/cli/test/check.test.ts packages/cli/test/action-patch.test.ts"
: > /w/logs/mutate.log
m() {
  local name=$1 file=$2 from=$3 to=$4
  bash /src/docs/bench/lexp/scripts/sync.sh >/dev/null
  cd /w/repo
  if ! grep -qF -- "$from" "$file"; then echo "$name NOT APPLIED" | tee -a /w/logs/mutate.log; return; fi
  FROM="$from" TO="$to" perl -0pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  if NO_COLOR=1 npx vitest run $TESTS > "/w/logs/mut-$name.log" 2>&1; then echo "$name SURVIVED" | tee -a /w/logs/mutate.log
  else echo "$name caught ($(grep -cE '^ +(FAIL|×)' "/w/logs/mut-$name.log") failing lines)" | tee -a /w/logs/mutate.log; fi
}
m M1-image-any $D 'return fix.releases?.length ? key.releases.some(v => fix.releases!.includes(v)) : key.candidate === fix.changes[0]!.to;' 'return true;'
m M2-time-bound $D 'if (!(at >= started && at <= uploaded)) return null;' ''
m M3-row-never-ends $D 'else s.ended = true;' ''
m M4-later-runs $D '(r.id as number) > options.runId || ' ''
m M5-event-filter $D '!["schedule", "workflow_dispatch"].includes(r.event as string) || ' ''
m M6-advisory-match $D 'return !!key && key.advisories.some(a => ids.has(a));' 'return !!key;'
m M7-limit $D 'runs.sort((a, b) => b.id - a.id).splice(limit);' 'runs.sort((a, b) => b.id - a.id);'
m M8-expired $D "a.expired === false && " ''
m M9-blob-token $D 'const zip = await api.fetchFn(location, { redirect: "error",' 'const zip = await api.fetchFn(location, { headers: { authorization: `Bearer ${api.token}` }, redirect: "error",'
m M10-merge-user $D 'if (p.user?.login !== BOT) return no' 'if (false) return no'
m M11-merge-base $D 'if (p.base?.ref !== defaultBranch) return no' 'if (false) return no'
m M12-merge-marker $D 'if (!body.startsWith("<!-- ludion-fix -->\n")) return no' 'if (false) return no'
m M13-once $D 'if (comments.some(c => c?.user?.login === BOT && typeof c.body === "string" && c.body.startsWith(MERGED_MARK))) return { outcome: "already_recorded" };' ''
m M14-other-bot $D 'c?.user?.login === BOT && typeof' 'typeof'
m M15-negative $D 'return ms < 0 ? `not computed: ${what}` :' 'return'
m M16-found-min $D 'else if (Date.parse(s.at) <= Date.parse(fix.found_at)) { fix.seen = { at: s.at, run: s.run, read: w.read, ended: s.ended }; fix.found_at = s.at; }' 'else if (Date.parse(s.at) <= Date.parse(fix.found_at)) { fix.seen = { at: s.at, run: s.run, read: w.read, ended: s.ended }; }'
m M17-walk-failure-stops $D '.catch(error => ({ why: errorText(error) }))' ''
m M18-seen-advisories $C 'advisories: [...new Set(own.map(f => f.advisory.id))].sort()' 'advisories: []'
m M19-seen-undecided $C 'if (!answer.decided || (commit' 'if ((commit'
m M20-check-sh-seen action/check.sh '[ -s "$seen" ] && echo "seen=true" >> "$GITHUB_OUTPUT"' 'echo "seen=true" >> "$GITHUB_OUTPUT"'
m M21-template-actions-read action/patch-workflow.yml '      actions: read' ''
m M22-start-merged-event action/start.sh 'if [ "$EVENT" != "pull_request" ]; then' 'if false; then'
m M23-zip-size $D 'return out && out.length === length ? Buffer.from(out) : null;' 'return out ? Buffer.from(out) : null;'
m M24-bounded $D 'if (total > max) { await reader.cancel(); return null; }' ''
echo done
