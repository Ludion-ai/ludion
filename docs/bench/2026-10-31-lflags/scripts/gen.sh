#!/bin/sh
# Runs in Docker only, in npm 12.2.1's image (fixtures/npm-corpus/npm-12.2.1.Dockerfile), with the network for the public
# registry's manifests (docs/decisions/2026-10-31-lock-flags-from-graph.md, section 3). For each project X1, X2, X4, X5
# and lockfileVersion 2 and 3: the base from its package.json, then the fix from the base's lock with node-fetch at
# 2.6.7, twice, with dependency-patch.ts's npm flags, as gen-extra.sh's node-fetch mode (LB2a) does.
# Output: /out/<name>/v<2|3>/{base,fix}/.
set -u
echo "# npm $(npm -v), node $(node -v)"
FLAGS="--ignore-scripts --no-audit --no-fund"
PATCH="--allow-git=none --allow-remote=none --allow-file=none --allow-directory=none --registry=https://registry.npmjs.org"
written() { sed -n 's/^  "lockfileVersion": \([0-9]*\),$/\1/p' "$1/package-lock.json" 2>/dev/null; }
project() {
  case "$1" in
  optional) echo '{ "name": "x1", "version": "1.0.0", "dependencies": { "node-fetch": "'"$2"'" }, "optionalDependencies": { "whatwg-url": "5.0.0" } }' ;;
  peer) echo '{ "name": "x2", "version": "1.0.0", "dependencies": { "node-fetch": "'"$2"'" }, "peerDependencies": { "whatwg-url": "5.0.0" } }' ;;
  optional-peer-other) echo '{ "name": "x4", "version": "1.0.0", "dependencies": { "encoding": "npm:left-pad@1.3.0", "node-fetch": "'"$2"'" } }' ;;
  optional-peer-in-range) echo '{ "name": "x5", "version": "1.0.0", "dependencies": { "encoding": "0.1.13", "node-fetch": "'"$2"'" } }' ;;
  esac
}
for name in optional peer optional-peer-other optional-peer-in-range; do
  for v in 2 3; do
    b="/out/$name/v$v/base"; f="/out/$name/v$v/fix"; mkdir -p "$b" "$f"
    project "$name" 2.6.1 > "$b/package.json"
    (cd "$b" && npm install --package-lock-only $FLAGS $PATCH --lockfile-version="$v" > npm.log 2>&1; echo $? > npm.exit)
    cp "$b/package-lock.json" "$f/" 2>/dev/null
    project "$name" 2.6.7 > "$f/package.json"
    (cd "$f" && { npm install --package-lock-only $FLAGS $PATCH && npm install --package-lock-only $FLAGS $PATCH; } > npm.log 2>&1; echo $? > npm.exit)
    echo "$name v$v base exit $(cat "$b/npm.exit") lockfileVersion $(written "$b"); fix exit $(cat "$f/npm.exit") lockfileVersion $(written "$f")"
  done
done
