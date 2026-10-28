#!/bin/sh
set -eu
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v)"
sha256sum packages/cli/src/security/workspace-manifests.ts packages/cli/src/security/judge.ts docs/bench/2026-10-28-l9-workspace-stop/scripts/module-check.ts | sed 's/^/# /'
for n in 161 162; do echo "== pr-$n"; node docs/bench/2026-10-28-l9-workspace-stop/scripts/module-check.ts /in/pr-$n; done
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
