#!/bin/sh
# Runs in Docker only, with --network none, in npm 12.2.1's image and in npm 11.19.1's (docs/decisions/2026-10-31-lock-corpus-npm12.md):
# this npm's report on every base lock and variant, whichever npm wrote it (npm ls --all --package-lock-only --json),
# into ls-<this npm>.json, .err and .exit beside the lock.
set -u
NPM=$(npm -v)
n=0
for dir in /out/*/v*/*/ /out/*/v*/*/variants/*/; do
  [ -f "$dir/package-lock.json" ] || continue
  (cd "$dir" && npm ls --all --package-lock-only --json > "ls-$NPM.json" 2> "ls-$NPM.err"; echo $? > "ls-$NPM.exit")
  n=$((n + 1))
done
echo "npm $NPM: npm ls on $n locks"
