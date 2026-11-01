#!/bin/sh
# Inside the container only (docs/bench/lc3/README.md). $1, when given, limits the rows, for a smoke run.
cd /w || exit 1
mkdir -p /v/cache /v/out
echo "measure commit ${LC3_COMMIT} start $(date -u +%Y-%m-%dT%H:%M:%SZ) limit ${1:-none}" >> /v/out/run-times.txt
node docs/bench/lc3/measure.mjs docs/bench/2026-10-28-backtest-v4/fixes-v4.json /v/cache /v/out/lc3-rows.json $1 > /v/out/run-output.txt 2>&1
code=$?
echo "measure end $(date -u +%Y-%m-%dT%H:%M:%SZ) exit ${code} memory.peak $(cat /sys/fs/cgroup/memory.peak)" >> /v/out/run-times.txt
cat /sys/fs/cgroup/memory.peak
