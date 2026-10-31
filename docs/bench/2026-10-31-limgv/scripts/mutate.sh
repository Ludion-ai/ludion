#!/bin/sh
# After full.sh (synced, built, stand-in repository in /w): each mutation alone, then the whole vitest run; files restored after each.
set -u
cd /w
caught=0; survived=0; skipped=0
for id in $(node /scripts/mutate.mjs list); do
  f=$(node /scripts/mutate.mjs file "$id"); cp /src/$f $f
  if ! node /scripts/mutate.mjs apply "$id" /w; then echo "$id not applied"; skipped=$((skipped+1)); continue; fi
  if NO_COLOR=1 npx vitest run --maxWorkers=2 >/tmp/m.log 2>&1; then
    echo "$id SURVIVED: $(grep -E '^ +Tests ' /tmp/m.log)"; survived=$((survived+1))
  else
    echo "$id caught: $(grep -E '^ +Tests ' /tmp/m.log)"; grep -E '^ +× ' /tmp/m.log | sort -u | head -4 | sed 's/^/    /'; caught=$((caught+1))
  fi
  cp /src/$f $f
done
for f in packages/cli/src/security/php.ts packages/cli/src/security/node.ts packages/cli/src/security/deliver.ts; do cmp $f /src/$f || echo "# $f differs"; done
echo "# sources restored"
echo "caught $caught, survived $survived, not applied $skipped"
