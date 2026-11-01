#!/usr/bin/env bash
# As smoke-live.sh, with an old commit time, so the anchor comes from the live facts.
set -uo pipefail
cd /w/repo
date -u +%Y-%m-%dT%H:%M:%SZ
for ex in npm-security php-security node-security composer-security; do
  echo "== examples/${ex} --changed-at 2020-01-01T00:00:00Z"
  node packages/cli/dist/cli.js check --dir "examples/${ex}" --changed-at 2020-01-01T00:00:00Z; echo "exit $?"
done
node packages/cli/dist/cli.js scan --dir examples/composer-security --json | grep -o '"id": "[A-Z]*-[^"]*"' | sort -u
