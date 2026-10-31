#!/bin/sh
# No network: each mutation of php.ts's choice (mutate.mjs) applied in /w alone, then security.test.ts and
# node-image.test.ts; a mutation is caught when vitest fails. php.ts is restored after each.
set -u
echo "# at commit ${LN_HEAD:-unknown}, ${LN_DIRTY:-unknown} files differing from it"
cd /w
[ -d .git ] || { git init -q && git add -A && git -c user.name=t -c user.email=t@example.invalid commit -qm stand-in; }
f=packages/cli/src/security/php.ts
cp $f /tmp/php.ts.orig
caught=0; survived=0; skipped=0
for id in $(node /scripts/mutate.mjs list); do
  cp /tmp/php.ts.orig $f
  if ! node /scripts/mutate.mjs apply "$id" $f; then echo "$id not applied"; skipped=$((skipped+1)); continue; fi
  if NO_COLOR=1 npx vitest run --project node packages/cli/test/security.test.ts packages/cli/test/node-image.test.ts >/tmp/m.log 2>&1; then
    echo "$id SURVIVED"; survived=$((survived+1))
  else
    echo "$id caught ($(grep -c 'FAIL\|×' /tmp/m.log) failing lines)"; caught=$((caught+1))
  fi
done
cp /tmp/php.ts.orig $f
cmp $f /src/$f && echo "# php.ts restored"
echo "caught $caught, survived $survived, not applied $skipped"
