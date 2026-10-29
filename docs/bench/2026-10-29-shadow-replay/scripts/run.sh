#!/usr/bin/env bash
# One replay over a snapshot of the recorder's store. The recorder keeps running: its data folder is only read, by
# copying captures/, osv/ and status/ into a new folder first. The judge's files at this commit must equal those at
# the commit the recorder's start line records (docs/decisions/2026-10-29-shadow-counting.md, section 4); otherwise
# nothing runs. So does a watched list other than the one whose sha256 the start line records. Runs in Docker (node:24-slim pinned by digest, read-only root, user 1000, no host environment).
# With NETWORK=1 it also runs the disputed check, which reads the registry, jsDelivr, ecosyste.ms, Software Heritage and
# OSV (package names and versions only); without it, the container has no network and every MAL-named version counts
# as malicious ("not checked").
#   bash docs/bench/2026-10-29-shadow-replay/scripts/run.sh <node_modules volume> <recorder data dir> <snapshot dir> <out.json>
set -eu
export MSYS_NO_PATHCONV=1
NM="$1"; DATA="$2"; SNAP="$3"; OUT="$4"
IMAGE=node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
[ -e "$SNAP" ] && { echo "$SNAP exists"; exit 1; }
[ -e "$OUT" ] && { echo "$OUT exists; a replay never overwrites an earlier output"; exit 1; }
mkdir -p "$SNAP"
cp -r "$DATA/captures" "$DATA/osv" "$DATA/status" "$SNAP/"
echo "snapshot taken at $(date -u +%FT%TZ): $(du -sb "$SNAP" | cut -f1) bytes"
START=$(grep -h '"type":"start"' "$SNAP"/status/*.jsonl | sed -E 's/.*"commit":"([0-9a-f]{40})".*/\1/' | sort -u)
[ "$(echo "$START" | wc -l)" = 1 ] || { echo "more than one start commit: $START"; exit 1; }
FILES="packages/cli/src/security/judge.ts packages/cli/src/security/npm-facts.ts packages/cli/src/security/time-cap.ts tools/backtest/src/archives-v5.ts"
# Against the working tree, which is what the container runs.
git diff --quiet "$START" -- $FILES || { echo "the judge's files in the working tree differ from the start commit $START"; exit 1; }
echo "start commit $START; judge files in the working tree unchanged (HEAD $(git rev-parse HEAD))"
WATCHED=$(grep -h '"type":"start"' "$SNAP"/status/*.jsonl | sed -E 's/.*"watched_sha256":"([0-9a-f]{64})".*/\1/' | sort -u)
[ "$WATCHED" = "$(sha256sum tools/shadow/watched.json | cut -d' ' -f1)" ] || { echo "tools/shadow/watched.json is not the list the recorder started with ($WATCHED)"; exit 1; }
echo "watched list $WATCHED"
W=$(pwd -W 2>/dev/null || pwd); S=$(cd "$SNAP" && (pwd -W 2>/dev/null || pwd)); O=$(cd "$(dirname "$OUT")" && (pwd -W 2>/dev/null || pwd))
NET="--network none"; CACHE=""
if [ "${NETWORK:-0}" = 1 ]; then NET=""; CACHE="--cache=/out/cache"; fi
docker run --rm $NET --read-only --tmpfs /tmp:exec --user 1000:1000 -e HOME=/tmp --memory 4g -v "$W:/w:ro" -v "$NM:/w/node_modules:ro" -v "$S:/data:ro" -v "$O:/out" -w /w "$IMAGE" \
  node tools/shadow/src/replay.ts /data "/out/$(basename "$OUT")" $CACHE
