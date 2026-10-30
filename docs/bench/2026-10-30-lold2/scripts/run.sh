# Runs inside node:24 as user 1000, read-only root, tmpfs /tmp, no credentials, no forwarded environment.
# /w: the repository at the run commit with its node_modules (installed with scripts off; read-only), /cache: fetched
# JSON answers and reference lists (named volume, deleted at the end), /tmp/git: commit and tag objects only (tmpfs),
# /out: results.
cd /w
B=docs/bench
echo "lold2 commit $1 selftest $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /out/run.log
node $B/2026-10-30-lold2/scripts/selftest.ts >> /out/run.log 2>&1 || { echo "selftest failed" >> /out/run.log; exit 1; }
echo "lold2 start $(date -u +%Y-%m-%dT%H:%M:%SZ) $2" >> /out/run.log
mkdir -p /tmp/git
node --max-old-space-size=6144 $B/2026-10-30-lold2/scripts/run-lold2.ts $B/2026-10-30-delta-v1/delta-v1.json $B/2026-10-30-lo-tarball-source/lo.json $B/2026-10-28-backtest-v5/malicious-v5.json /cache /tmp/git /out/lold2.json $2 > /out/lold2.log 2>&1
code=$?
echo "lold2 end $(date -u +%Y-%m-%dT%H:%M:%SZ) exit $code" >> /out/run.log
