#!/usr/bin/env bash
# The commands behind logs/measure-pc.log, read-only over the PC recorder's data directory: sizes, gzip -6 ratios and
# known/ file sizes, then measure-pc.mjs (record types, bytes per hour, poll durations). The log of 2026-10-29T01:13:00Z
# was made by these same commands, typed in one shell line, before this file was written.
#   bash docs/bench/2026-10-29-shadow-actions/scripts/measure-pc.sh /c/dev/ludion-shadow-data/data > logs/measure-pc.log 2>&1
set -u
D=$1
here=$(cd "$(dirname "$0")" && pwd)
echo "measured_at $(date -u +%FT%TZ)"
echo "data_dir_bytes $(du -sb "$D" | cut -f1)"
echo "known_bytes $(du -sb "$D/known" | cut -f1) created_bytes $(du -sb "$D/known/created" | cut -f1)"
echo "known_files $(find "$D/known" -type f -not -path '*/created/*' | wc -l) created_files $(find "$D/known/created" -type f | wc -l)"
for f in "$D"/captures/*.jsonl; do s=$(stat -c %s "$f"); g=$(gzip -6 -c "$f" | wc -c); echo "gzip6 $(basename "$f") $s -> $g"; done
s=$(du -sb "$D/known" | cut -f1); g=$(tar -C "$D" -cf - known | gzip -6 | wc -c); echo "gzip6 known/ $s -> $g"
find "$D/known" -type f -not -path '*/created/*' -printf '%s\n' | sort -n | awk '{ a[NR] = $1; s += $1 } END { print "known_file_bytes n", NR, "median", a[int(NR / 2) + 1], "p90", a[int(NR * 0.9) + 1], "max", a[NR], "mean", int(s / NR) }'
node "$here/measure-pc.mjs" "$D"
