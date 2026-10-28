#!/bin/sh
# In Docker, on the volume /w: typecheck (root and worker), the CLI tests, the full node test project, the build,
# the module's mutants (L9's 2026-10-28 mutate.mjs) and the wiring's mutants.
set -u
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), HEAD $(cat /s/HEAD 2>/dev/null || echo unknown)"
echo "== npm run typecheck"; npm run typecheck; echo "typecheck exit $?"
echo "== npx vitest run --project node"; NO_COLOR=1 npx vitest run --project node; echo "vitest exit $?"
echo "== npm run build"; npm run build >/tmp/build.log 2>&1; echo "build exit $?"; tail -5 /tmp/build.log
echo "== node mutate.mjs (module)"; node /w/docs/bench/2026-10-28-l9-workspace-stop/scripts/mutate.mjs
echo "== node mutate-wiring.mjs"; node /w/docs/bench/2026-10-29-l9-wiring/scripts/mutate-wiring.mjs
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
