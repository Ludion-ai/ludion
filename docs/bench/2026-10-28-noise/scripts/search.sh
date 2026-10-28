#!/bin/sh
# The registered search (docs/decisions.md, "Noise measurement"): one GraphQL search per UTC hour of 2026-10-27,
# first 100 results each, saved as-is. gh keeps its own credentials; nothing is passed to containers.
# A failed query (HTTP error, or no JSON) is retried up to 3 times; every failed attempt is logged in search/attempts.log.
set -u
OUT="$1"
mkdir -p "$OUT/search"
QUERY='query($q: String!) {
  search(type: ISSUE, query: $q, first: 100) {
    issueCount
    nodes { ... on PullRequest { url createdAt headRefName author { login }
      repository { nameWithOwner owner { login } isFork isArchived isTemplate isPrivate
        defaultBranchRef { target { oid } }
        lock: object(expression: "HEAD:package-lock.json") { ... on Blob { byteSize } }
        manifest: object(expression: "HEAD:package.json") { ... on Blob { byteSize } } } } }
  }
}'
for h in 00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23; do
  ok=0
  for attempt in 1 2 3; do
    if gh api graphql -f q="is:pr is:public author:app/dependabot label:javascript created:2026-10-27T$h:00:00Z..2026-10-27T$h:59:59Z sort:created-desc" -f query="$QUERY" > "$OUT/search/hour-$h.json" 2> "$OUT/search/.err" && grep -q '"search"' "$OUT/search/hour-$h.json"; then ok=1; break; fi
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) hour $h attempt $attempt failed: $(head -c 200 "$OUT/search/.err" | tr '\n' ' ')" >> "$OUT/search/attempts.log"
    sleep $((20 * attempt))
  done
  rm -f "$OUT/search/.err"
  if [ "$ok" = 1 ]; then echo "hour $h saved"; else echo "hour $h FAILED after 3 attempts"; exit 1; fi
done
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/search/searched-at.txt"
