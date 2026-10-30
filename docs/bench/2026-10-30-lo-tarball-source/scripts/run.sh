# Runs inside node:24-slim as user 1000, read-only root, tmpfs /tmp, no credentials, no forwarded environment.
# /w: the repository at the run commit with its node_modules (read-only), /in: LD's delta-v1.json from 79f8816
# (read-only), /cache: fetched answers (named volume, deleted at the end), /out: results.
cd /w
echo "lo commit $1 selftest $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /out/run.log
node docs/bench/2026-10-30-lo-tarball-source/scripts/selftest.ts >> /out/run.log 2>&1 || { echo "selftest failed" >> /out/run.log; exit 1; }
echo "lo start $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /out/run.log
node docs/bench/2026-10-30-lo-tarball-source/scripts/run-lo.ts /in/delta-v1.json docs/bench/2026-10-28-backtest-v5/malicious-v5.json /cache /out/lo.json > /out/lo.log 2>&1
code=$?
echo "lo end $(date -u +%Y-%m-%dT%H:%M:%SZ) exit $code" >> /out/run.log
