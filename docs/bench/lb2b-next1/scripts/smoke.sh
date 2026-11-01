#!/usr/bin/env bash
# Inside the container, no network: the built bundle's `ludion check` on the owned examples (OSV unreachable).
set -uo pipefail
cd /w/repo
for ex in npm-security php-security; do
  echo "== examples/${ex} (no network)"
  node packages/cli/dist/cli.js check --dir "examples/${ex}" --changed-at 2026-11-01T00:00:00Z; echo "exit $?"
done
echo "== help"
node packages/cli/dist/cli.js help | grep -A1 "ludion check"
