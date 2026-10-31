#!/bin/sh
# Runs in Docker only, with --network none, in npm 12.2.1's image and in npm 11.19.1's, as ls.sh, on the locks
# gen-extra.sh wrote (docs/decisions/2026-10-31-lock-flags-only.md): ls-<this npm>.json, .err and .exit beside each.
set -u
NPM=$(npm -v)
n=0
for dir in /out/extra/inbundle/*/v*/ /out/extra/node-fetch/v*/*/; do
  [ -f "$dir/package-lock.json" ] || continue
  (cd "$dir" && npm ls --all --package-lock-only --json > "ls-$NPM.json" 2> "ls-$NPM.err"; echo $? > "ls-$NPM.exit")
  n=$((n + 1))
done
echo "npm $NPM: npm ls on $n locks"
