#!/usr/bin/env bash
# Four deliberate mutations of shadow.yml's checks; each must make packages/cli/test/shadow-workflow.test.ts fail. The
# tests run in Docker with no network, in node:24-slim (by digest) with git, jq and unzip added (the image below). The
# workflow is restored after each. Run from the repository root with a Linux node_modules volume:
#   bash docs/bench/2026-10-29-shadow-actions/scripts/mutations.sh ludion-ls-nm > docs/bench/2026-10-29-shadow-actions/logs/mutations.log 2>&1
set -u
export MSYS_NO_PATHCONV=1
NM=$1
W=$(pwd -W 2> /dev/null || pwd)
F=.github/workflows/shadow.yml
IMAGE=ludion-sa-node24-tools
docker build -q -t "$IMAGE" - > /dev/null << 'DOCKERFILE'
FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends git jq unzip ca-certificates > /dev/null && rm -rf /var/lib/apt/lists/*
DOCKERFILE
echo "workflow blob $(git hash-object "$F"), test blob $(git hash-object packages/cli/test/shadow-workflow.test.ts)"
cp "$F" "$F.orig"
mut() {
  node -e "const fs=require('fs');const s=fs.readFileSync('$F','utf8');const t=s.replace(process.argv[1],process.argv[2]);if(t===s)process.exit(3);fs.writeFileSync('$F',t)" "$2" "$3" || { echo "$1: not applied"; return; }
  echo "== mutation: $1"
  docker run --rm --network none --read-only --tmpfs /tmp:exec --user 1000:1000 -e HOME=/tmp -v "$W:/w:ro" -v "$NM:/w/node_modules" -w /w "$IMAGE" \
    sh -c "npx vitest run packages/cli/test/shadow-workflow.test.ts 2>&1 | grep -E 'Tests '"
  cp "$F.orig" "$F"
}
mut "file-type check off" "if grep -qv '^-' listing.txt; then" "if false; then"
mut "path check off" 'if grep -Evq "$allowed" files.txt; then' 'if false; then'
mut "root check off" 'if [ "$root" != "known runs state.json " ]; then' 'if false; then'
mut "moved-branch check off" 'if [ "$head" != "$DATA_SHA" ]; then' 'if false; then'
rm "$F.orig"
git diff --quiet -- "$F" && echo "shadow.yml restored"
