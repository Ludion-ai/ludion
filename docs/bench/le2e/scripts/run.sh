#!/bin/sh
# usage: run.sh <name> [playwright args]
cd /w || exit 9
name=$1; shift
OUT=/w/_le2e/out/$name
mkdir -p "$OUT"
start=$(date +%s.%N)
PLAYWRIGHT_JSON_OUTPUT_NAME=$OUT/report.json npx playwright test --workers=2 --reporter=list,json "$@" > "$OUT/log.txt" 2>&1
code=$?
end=$(date +%s.%N)
printf 'exit=%s start=%s end=%s\n' "$code" "$start" "$end" > "$OUT/wall.txt"
exit $code
