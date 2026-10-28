#!/usr/bin/env bash
# Stands in for gh in the action check (run.sh): answers `gh api` from the files in $FIXTURES, named by method and
# endpoint, and records every call and every write instead of sending it.
set -euo pipefail
[ "${1:-}" = api ] || { echo "gh stub: only gh api" >&2; exit 2; }
shift
method=GET filter= input= endpoint=
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method=$2; shift 2 ;;
    --jq) filter=$2; shift 2 ;;
    --input) input=$2; shift 2 ;;
    -H) shift 2 ;;
    --paginate) shift ;;
    *) endpoint=$1; shift ;;
  esac
done
echo "$method $endpoint" >> "$FIXTURES/calls.log"
if [ "$method" != GET ]; then
  n=$(ls "$FIXTURES" | grep -c '^written-' || true)
  cp "$input" "$FIXTURES/written-$((n + 1))-${method}.json"
  echo '{}'
  exit 0
fi
file="$FIXTURES/$(printf '%s' "$endpoint" | tr -c 'A-Za-z0-9._-' '_')"
[ -f "$file" ] || { echo "gh stub: no fixture for ${endpoint}" >&2; exit 1; }
if [ -n "$filter" ]; then jq -r "$filter" "$file"; else cat "$file"; fi
