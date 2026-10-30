#!/bin/sh
# Runs in Docker only, with --network none, in the npm image that wrote the locks: npm's own report on each base lock and
# each variant (npm ls --all --package-lock-only --json), into ls.json, ls.err and ls.exit beside the lock.
set -u
NPM=$(npm -v)
n=0
for dir in /out/"$NPM"/v*/*/ /out/"$NPM"/v*/*/variants/*/; do
  [ -f "$dir/package-lock.json" ] || continue
  (cd "$dir" && npm ls --all --package-lock-only --json > ls.json 2> ls.err; echo $? > ls.exit)
  n=$((n + 1))
done
echo "npm $NPM: npm ls on $n locks"
