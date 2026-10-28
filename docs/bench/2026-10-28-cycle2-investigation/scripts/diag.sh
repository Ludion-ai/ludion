#!/bin/sh
# Builds the diagnostic copy in the volume copy (never in the repo) and runs it offline on v4's cache.
set -eu
cd /w
cat tools/backtest/src/malicious-v4.ts /s/diag-block.ts > tools/backtest/src/diag-unknown.ts


DIAG_OUT=/out/diag-unknown.json node tools/backtest/src/diag-unknown.ts /osv docs/bench/2026-10-28-backtest-rerun/malicious-v2.json /cache /out/malicious-v4-rerun.json > /out/diag-stdout.txt 2> /out/diag-stderr.txt
tail -3 /out/diag-stderr.txt
rm tools/backtest/src/diag-unknown.ts
