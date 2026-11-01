#!/usr/bin/env bash
# Inside the container, with the network (no socket, no credentials): the built bundle's `ludion check` against the
# real OSV, npm registry, CISA KEV, FIRST EPSS, php.net, nodejs.org and Docker Hub, on the owned examples.
set -uo pipefail
cd /w/repo
date -u +%Y-%m-%dT%H:%M:%SZ
for ex in npm-security php-security node-security composer-security maven-security; do
  echo "== examples/${ex}"
  node packages/cli/dist/cli.js check --dir "examples/${ex}" --changed-at 2026-11-01T00:00:00Z; echo "exit $?"
done
echo "== examples/npm-security --json"
node packages/cli/dist/cli.js check --dir examples/npm-security --changed-at 2026-11-01T00:00:00Z --json
