set -e
cd /w
node tools/backtest/src/malicious-v5.ts /osv docs/bench/2026-10-28-backtest-rerun/malicious-v2.json docs/bench/2026-10-28-backtest-v4/malicious-v4.json /cache /out/smoke-buffer.json --only=@ensdomains/buffer@0.1.1
