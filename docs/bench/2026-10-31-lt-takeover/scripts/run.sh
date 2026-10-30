# Lane LT, one phase. Runs inside node:24 as user 1000, read-only root, tmpfs /tmp, no credentials, no forwarded
# environment, --memory 3g. /w: the repository at the run commit with its node_modules (installed with scripts off;
# read-only), /cache: fetched JSON answers, reference lists and GH Archive matches per hour (named volume, deleted at
# the end), /out: results. Usage: sh run.sh <refs|archive|source|summary> <run commit>
cd /w
B=docs/bench
S=$B/2026-10-31-lt-takeover/scripts
echo "lt $1 commit $2 selftest $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /out/run.log
node $S/selftest.ts >> /out/run.log 2>&1 || { echo "selftest failed" >> /out/run.log; exit 1; }
echo "lt $1 start $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /out/run.log
case "$1" in
  refs) node --max-old-space-size=2560 $S/lt.ts refs $B/2026-10-28-backtest-v5/malicious-v5.json $B/2026-10-30-lold2/lold2.json /cache /out > /out/refs.log 2>&1 ;;
  archive) node --max-old-space-size=2560 $S/lt.ts archive /cache /out > /out/archive.log 2>&1 ;;
  source) node --max-old-space-size=2560 $S/lt.ts source /cache /out > /out/source.log 2>&1 ;;
  summary) node --max-old-space-size=2560 $S/lt.ts summary $B/2026-10-30-lold2/lold2.json /out > /out/summary.log 2>&1 ;;
  *) echo "unknown phase $1" >> /out/run.log; exit 2 ;;
esac
code=$?
echo "lt $1 end $(date -u +%Y-%m-%dT%H:%M:%SZ) exit $code" >> /out/run.log
