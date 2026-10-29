#!/usr/bin/env bash
# One replay over a snapshot of the recorder's store. The recorder keeps running: its data folder is only read, by
# copying captures/, osv/ and status/ into a new folder first. The judge's files are those of
# the commit the recorder's start line records (docs/decisions/2026-10-29-shadow-counting.md, section 4), whatever
# HEAD holds. A watched list other than the one whose sha256 the start line records stops it. Runs in Docker
# (node:24-slim pinned by digest, read-only root, user 1000, no host environment).
# With NETWORK=1 it also runs the disputed check, which reads the registry, jsDelivr, ecosyste.ms, Software Heritage and
# OSV (package names and versions only); without it, the container has no network and every MAL-named version counts
# as malicious ("not checked"). A final result needs NETWORK=1: OSV is also asked by package name. Each networked run
# reads the network afresh, into <out>.cache beside its output.
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
# The container runs a tree of its own: HEAD's committed files (not the working tree), with the judge's files taken
# from the start commit, so that a later change to the judge does not change the count (section 4).
git diff --quiet HEAD -- tools/shadow || { echo "tools/shadow has uncommitted changes; commit them first"; exit 1; }
TREE="$SNAP.tree"
mkdir -p "$TREE/node_modules"
git -c core.autocrlf=false archive HEAD | (cd "$TREE" && tar -x)
for f in $FILES; do git -c core.autocrlf=false show "$START:$f" > "$TREE/$f"; done
echo "start commit $START; replay at HEAD $(git rev-parse HEAD); judge files from the start commit:"
for f in $FILES; do echo "  $f $(git hash-object "$TREE/$f") (start: $(git rev-parse "$START:$f"))"; done
WATCHED=$(grep -h '"type":"start"' "$SNAP"/status/*.jsonl | sed -E 's/.*"watched_sha256":"([0-9a-f]{64})".*/\1/' | sort -u)
[ "$WATCHED" = "$(sha256sum < "$TREE/tools/shadow/watched.json" | cut -d' ' -f1)" ] || { echo "tools/shadow/watched.json is not the list the recorder started with ($WATCHED)"; exit 1; }
echo "watched list $WATCHED"
W=$(cd "$TREE" && (pwd -W 2>/dev/null || pwd)); S=$(cd "$SNAP" && (pwd -W 2>/dev/null || pwd)); O=$(cd "$(dirname "$OUT")" && (pwd -W 2>/dev/null || pwd))
NET="--network none"; CACHE=""
# A cache of its own per run, next to its output: a final run never reads answers fetched for an earlier one.
CACHE_DIR="$(dirname "$OUT")/$(basename "$OUT" .json).cache"
if [ "${NETWORK:-0}" = 1 ]; then
  [ -e "$CACHE_DIR" ] && { echo "$CACHE_DIR exists; each networked run fetches afresh"; exit 1; }
  NET=""; CACHE="--cache=/out/$(basename "$CACHE_DIR")"
fi
docker run --rm $NET --read-only --tmpfs /tmp:exec --user 1000:1000 -e HOME=/tmp -e NODE_OPTIONS=--max-old-space-size=3584 --memory 4g -v "$W:/w:ro" -v "$NM:/w/node_modules:ro" -v "$S:/data:ro" -v "$O:/out" -w /w "$IMAGE" \
  node tools/shadow/src/replay.ts /data "/out/$(basename "$OUT")" $CACHE
