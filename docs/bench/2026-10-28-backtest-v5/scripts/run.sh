cd /w
echo "malicious-v5 commit $1 start $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /out/run.log
node tools/backtest/src/malicious-v5.ts /osv docs/bench/2026-10-28-backtest-rerun/malicious-v2.json docs/bench/2026-10-28-backtest-v4/malicious-v4.json /cache /out/malicious-v5.json > /out/malicious-v5.log 2>&1
code=$?
echo "malicious-v5 end $(date -u +%Y-%m-%dT%H:%M:%SZ) exit $code" >> /out/run.log
