#!/bin/sh
# L1d: the third sample's search (docs/decisions/2026-10-29-l1d-third-sample.md); L1c's search.sh with the day changed, in pages of 50, the form the first run
# used for all 24 hours (docs/bench/2026-10-28-noise/scripts/search2.sh, unchanged but for the day). Each UTC hour of
# 2026-10-25 is fetched as two pages of 50 (the first 100 results, same order,
# same fields), saved raw as hour-HH.p1.json and hour-HH.p2.json; join.mjs joins them into hour-HH.json.
# A failed page is retried up to 3 times; every failed attempt is logged.
set -u
OUT="$1"
mkdir -p "$OUT/search"
QUERY='query($q: String!, $after: String) {
  search(type: ISSUE, query: $q, first: 50, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { url createdAt headRefName author { login }
      repository { nameWithOwner owner { login } isFork isArchived isTemplate isPrivate
        defaultBranchRef { target { oid } }
        lock: object(expression: "HEAD:package-lock.json") { ... on Blob { byteSize } }
        manifest: object(expression: "HEAD:package.json") { ... on Blob { byteSize } } } } }
  }
}'
page() { # hour, page number, cursor ("" for the first page)
  for attempt in 1 2 3; do
    if [ -z "$3" ]; then
      gh api graphql -f q="is:pr is:public author:app/dependabot label:javascript created:2026-10-25T$1:00:00Z..2026-10-25T$1:59:59Z sort:created-desc" -f query="$QUERY" > "$OUT/search/hour-$1.p$2.json" 2> "$OUT/search/.err"
    else
      gh api graphql -f q="is:pr is:public author:app/dependabot label:javascript created:2026-10-25T$1:00:00Z..2026-10-25T$1:59:59Z sort:created-desc" -f after="$3" -f query="$QUERY" > "$OUT/search/hour-$1.p$2.json" 2> "$OUT/search/.err"
    fi
    if grep -q '"search"' "$OUT/search/hour-$1.p$2.json"; then rm -f "$OUT/search/.err"; return 0; fi
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) hour $1 page $2 attempt $attempt failed: $(head -c 200 "$OUT/search/.err" | tr '\n' ' ')" >> "$OUT/search/attempts.log"
    sleep $((20 * attempt))
  done
  rm -f "$OUT/search/.err"
  return 1
}
for h in 00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23; do
  page "$h" 1 "" || { echo "hour $h page 1 FAILED"; exit 1; }
  cursor=$(sed -n 's/.*"endCursor":"\([^"]*\)".*/\1/p' "$OUT/search/hour-$h.p1.json")
  if grep -q '"hasNextPage":true' "$OUT/search/hour-$h.p1.json"; then
    page "$h" 2 "$cursor" || { echo "hour $h page 2 FAILED"; exit 1; }
  fi
  echo "hour $h saved"
done
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/search/searched-at.txt"
