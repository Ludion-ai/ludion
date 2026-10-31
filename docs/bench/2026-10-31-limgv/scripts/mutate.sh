#!/bin/sh
# Sync, then each mutation alone and the whole vitest run (node project, two workers); files restored after each.
set -u
sh /scripts/sync.sh
cd /w
git init -q && git add -A && git -c user.name=t -c user.email=t@example.invalid commit -qm stand-in
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
caught=0; survived=0; skipped=0; void=0
for id in $(node /scripts/mutate.mjs list); do
  f=$(node /scripts/mutate.mjs file "$id"); cp /src/$f $f
  if ! node /scripts/mutate.mjs apply "$id" /w; then echo "$id not applied"; skipped=$((skipped+1)); continue; fi
  NO_COLOR=1 npx vitest run --project node --maxWorkers=2 >/tmp/m.log 2>&1; code=$?
  tests=$(grep -E '^ +Tests ' /tmp/m.log)
  if [ -z "$tests" ]; then echo "$id RUN VOID (exit $code)"; tail -5 /tmp/m.log | sed 's/^/    /'; void=$((void+1))
  elif [ $code -eq 0 ]; then echo "$id SURVIVED: $tests"; survived=$((survived+1))
  else echo "$id caught: $tests"; grep -E '^ +× ' /tmp/m.log | sort -u | head -3 | sed 's/^/    /'; caught=$((caught+1)); fi
  cp /src/$f $f
done
for f in packages/cli/src/security/php.ts packages/cli/src/security/node.ts packages/cli/src/security/deliver.ts packages/cli/src/security/exposure.ts packages/cli/src/security/patch.ts; do cmp $f /src/$f || echo "# $f differs"; done
echo "# sources restored"
echo "caught $caught, survived $survived, not applied $skipped, void $void"
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
