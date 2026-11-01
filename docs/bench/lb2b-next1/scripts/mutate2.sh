#!/usr/bin/env bash
# Inside the container, no network: the review's surviving mutations (R08, R09, R11) and more of check.sh's older-base
# branch; each must fail check.test.ts or action-patch.test.ts.
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
C=packages/cli/src/security/check.ts S=action/check.sh
m R08-behind-never $S 's/if \[ "\$behind" != 0 \]; then/if false; then/'
m R11-no-300-limit $S 's/ || \[ "\$count" -ge 300 \]//'
m R09-bad-wait-until $C 's/if (result.wait_until !== undefined \&\& until === null) return undecided/if (false) return undecided/'
m S01-root-any-moved $S 's/ || { \[ "\$dir" = . \] \&\& \[ "\$count" -gt 0 \]; }//'
m S02-folder-file-ignored $S 's/      || awk -v p="\${dir}\/" .NR > 1 \&\& index(\$0, p) == 1 { found = 1 } END { exit !found }. "\$scratch\/moved"; then/      ; then/'
m S03-second-compare-fail-counted $S '/GitHub did not list what changed since its merge base; not counted./{n;s/continue/:/}'
m S04-count-not-number $S 's/if ! \[\[ "\$count" =~ ^\[0-9\]+\$ \]\] || /if /'
m S05-previous-name-ignored $S 's/(.files\[\] | .filename, (.previous_filename \/\/ empty))/(.files[] | .filename)/'
m S06-limit-301 $S 's/\[ "\$count" -ge 300 \]/[ "$count" -ge 301 ]/'
m S07-prefix-no-slash $S 's/awk -v p="\${dir}\/"/awk -v p="${dir}"/'
echo "caught ${caught} of ${total}"
