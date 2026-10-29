#!/bin/sh
# In Docker, offline, on the volume /w (HOME on a tmpfs for astro; the image has no git, so apps/site/test/knowledge.test.ts
# and the astro build, which run git, fail here and are left to CI): typecheck, the node tests, the build, and every
# mutant of the workspace rule: L9's module mutants (2026-10-28), its wiring mutants (2026-10-29) and this lane's.
set -u
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), HEAD $(cat /s/HEAD 2>/dev/null || echo unknown)"
echo "== sha256"; sha256sum packages/cli/src/security/workspace-manifests.ts packages/cli/src/security/judge.ts packages/cli/src/security/judge-cli.ts packages/cli/test/workspace-manifests.test.ts
echo "== npm run typecheck"; npm run typecheck; echo "typecheck exit $?"
echo "== npx vitest run --project node"; NO_COLOR=1 npx vitest run --project node; echo "vitest exit $?"
echo "== npm run build"; npm run build >/tmp/build.log 2>&1; echo "build exit $?"; tail -5 /tmp/build.log
echo "== node mutate.mjs (module, 2026-10-28)"; node /w/docs/bench/2026-10-28-l9-workspace-stop/scripts/mutate.mjs
echo "== node mutate-wiring.mjs (2026-10-29)"; node /w/docs/bench/2026-10-29-l9-wiring/scripts/mutate-wiring.mjs
echo "== node mutate-l9b.mjs"; node /w/docs/bench/2026-10-29-l9b-workspace-findings/scripts/mutate-l9b.mjs
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
