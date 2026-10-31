#!/bin/sh
# Runs in Docker only, with --network none, in npm 12.2.1's image and in npm 11.19.1's, on every lock under /out that
# has a package-lock.json: ls-<this npm>.json, .err and .exit beside each (as LB2a's ls-extra.sh).
set -u
NPM=$(npm -v)
n=0
for lock in $(find /out -name package-lock.json | sort); do
  dir=$(dirname "$lock")
  (cd "$dir" && npm ls --all --package-lock-only --json > "ls-$NPM.json" 2> "ls-$NPM.err"; echo $? > "ls-$NPM.exit")
  n=$((n + 1))
done
echo "npm $NPM: npm ls on $n locks"
