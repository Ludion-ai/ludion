#!/usr/bin/env bash
# Inside the container, no network: each mutation is one sed on a file; the check tests must fail on it.
set -uo pipefail
bash /s/sync.sh >/dev/null
cd /w/repo
caught=0; total=0
m() { # m <name> <file> <sed expression>
  local name=$1 file=$2 expr=$3
  cp "$file" /tmp/orig
  sed -i "$expr" "$file"
  total=$((total + 1))
  if cmp -s "$file" /tmp/orig; then echo "MUTATION DID NOT APPLY: $name"; cp /tmp/orig "$file"; return; fi
  if NO_COLOR=1 timeout 300 npx vitest run packages/cli/test/check.test.ts packages/cli/test/action-patch.test.ts > /tmp/m.log 2>&1; then echo "survived: $name"; else echo "caught: $name"; caught=$((caught + 1)); fi
  cp /tmp/orig "$file"
}
C=packages/cli/src/security/check.ts S=action/check.sh W=action/patch-workflow.yml
m M01-scan-auto $C 's/try { report = await scan(root, ecosystem); }/try { report = await scan(root, "auto"); }/'
m M02-unknown-72h $C 's/urgency === "unknown" ? WAIT_HOURS.exploited/urgency === "unknown" ? WAIT_HOURS.normal/'
m M03-no-doubling $C 's/const doubles = (m: number) => m <= 0 || Number.isInteger(Math.log2(m));/const doubles = (m: number) => m <= 0;/'
m M04-commit-time-ignored $C 's/const times = \[changedAt, ...own.map/const times = [0, ...own.map/'
m M05-smallest-only $C 's/semver.gte(v, tos\[0\]!)/v === tos[0]!/'
m M06-kev-other-package-ignored $C 's/if (kev \&\& findings.some(f => aliases(f).some(a => kev!.has(a)))) return "exploited";/if (kev \&\& findings.slice(0, 1).some(f => aliases(f).some(a => kev!.has(a)))) return "exploited";/'
m M08-unknown-returns-quiet $C 's/if (times.some(t => t === null)) return { key, state: "due"/if (times.some(t => t === null)) return { key, state: "quiet"/'
m M09-image-nonsecurity-no-key $C 's/if (!result.candidate) return/if (!result.candidate || !result.security_releases.length) return/'
m M10-image-wait-ignored $C 's/keys: \[decide(ecosystem, until, times/keys: [decide(ecosystem, null, times/'
m M11-keys-only-reads $C 's/if (deps.keysOnly) return { ...head, ecosystem, outside, decided: true, urgency: null, keys: packages.map/if (false) return { ...head, ecosystem, outside, decided: true, urgency: null, keys: packages.map/'
m M12-pksa-to-osv $C 's/|| id.startsWith("PKSA-")) { records.set(id, null)/) { records.set(id, null)/'
m M13-incomplete-decided $C 's/if (result.status === "incomplete") return undecided/if (false) return undecided/'
m M14-maven-scanned $C 's/if (ecosystem === "maven") return undecided/if (false) return undecided/'
m M15-error-decided $C 's/if ("error" in check) return undecided(/if ("error" in check \&\& !check.security_releases) return undecided(/'
m M16-sh-undecided-false $S 's/answer true "ludion check could not decide/answer false "ludion check could not decide/'
m M17-sh-any-author $S 's/\[ "\$login" = "github-actions\[bot\]" \] \&\& //'
m M18-sh-any-branch $S 's/ \&\& \[ "\${ref#ludion\/}" != "\$ref" \]//'
m M19-sh-gh-fail-false $S 's/|| answer true "GitHub did not list the open PRs."/|| answer false "GitHub did not list the open PRs."/'
m M20-sh-no-changed-at $S 's/node "\$CLI" check --dir "\$PROJECT" --changed-at "\$changed"/node "$CLI" check --dir "$PROJECT"/'
m M21-sh-head-undecided-counted $S 's/|| \[ "\$(head -n 1 "\$scratch\/pr-\${number}.txt" | cut -f 1)" != decided \]; then/; then/'
m M22-wf-patch-always-skips $W "s/if: \${{ !cancelled() \&\& needs.check.outputs.work != 'false' }}/if: \${{ needs.check.outputs.work == 'true' }}/"
m M23-wf-check-write $W 's/      pull-requests: read/      pull-requests: write/'
m M24-high-ignored $C 's/=== "CRITICAL")) return "high";/=== "NOPE")) return "high";/'
m M25-epss-ignored $C 's/(scores.get(c) ?? 0) >= 0.1/(scores.get(c) ?? 0) >= 2/'
echo "caught ${caught} of ${total}"
