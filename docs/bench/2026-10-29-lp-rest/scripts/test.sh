#!/usr/bin/env bash
# Typecheck and the node tests of one commit, in Docker: the commit is unpacked with git archive into a new volume, its
# dependencies are installed with no scripts (the one step with network), and the checks run with no network, a
# read-only root and the node user. Image ludion-c3-test: node:24-slim with jq, unzip and git.
# Run on the host from the repository root: bash docs/bench/2026-10-29-lp-rest/scripts/test.sh <commit> <log>
set -uo pipefail
sha=$(git rev-parse --verify "$1^{commit}") log=$2 vol="ludion-lpr-${1:0:7}"
docker volume rm -f "$vol" > /dev/null 2>&1
docker volume create "$vol" > /dev/null
git archive "$sha" | docker run --rm -i -v "$vol:/w" node:24-slim sh -c 'tar -x -C /w && chown -R 1000:1000 /w'
{
  echo "commit ${sha}, started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  docker image inspect ludion-c3-test --format 'image ludion-c3-test {{.Id}}'
  MSYS_NO_PATHCONV=1 docker run --rm --user 1000:1000 -e HOME=/tmp -v "$vol:/w" -w /w ludion-c3-test npm ci --ignore-scripts --no-audit --no-fund 2>&1 | tail -3
  MSYS_NO_PATHCONV=1 docker run --rm --network none --read-only --tmpfs /tmp:exec --user 1000:1000 -e HOME=/tmp -v "$vol:/w" -w /w ludion-c3-test sh -c '
    node --version; jq --version; git --version
    npm run typecheck > /tmp/tc.txt 2>&1; echo "typecheck exit $?"; tail -5 /tmp/tc.txt
    npm run build -w ludion-ai > /tmp/b.txt 2>&1; echo "build exit $?"
    npx vitest run --project node packages > /tmp/v.txt 2>&1; echo "vitest exit $?"; tail -40 /tmp/v.txt'
  echo "finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} 2>&1 | tee "$log"
