# Runs inside node:24-slim as user 1000, read-only root, no credentials, no forwarded environment.
# /w: the repository at the run commit (read-only), /cache: JSON answers only, /out: results.
cd /w
echo "delta-v1 commit $1 start $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /out/run.log
node tools/backtest/src/delta-v1.ts docs/bench/2026-10-28-backtest-v5/malicious-v5.json docs/bench/2026-10-28-backtest-v4/fixes-v4.json /cache /out/delta-v1.json /out/detail.json > /out/delta-v1.log 2>&1
code=$?
echo "delta-v1 end $(date -u +%Y-%m-%dT%H:%M:%SZ) exit $code" >> /out/run.log
