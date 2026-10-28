#!/bin/sh
# In Docker: build each judge (fixed = /w, unfixed = /m, main) and run both on the same inputs with the same --now,
# as judge.yml runs it (--before, --after, --files, --json; no --source). The judge reads the registry and OSV.
set -u
NOW="$1"
for tree in /w /m; do
  (cd "$tree" && npm run build --workspace ludion-ai >/tmp/build.log 2>&1; echo "# build $tree exit $? sha256 $(sha256sum packages/cli/dist/cli.js | cut -d' ' -f1)")
done
for n in 161 162; do
  files=$(paste -sd, /in/pr-$n/files)
  for tree in /w /m; do
    name=$([ "$tree" = /w ] && echo fixed || echo unfixed)
    started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    node "$tree/packages/cli/dist/cli.js" judge --before /in/pr-$n/before --after /in/pr-$n/after --files "$files" --now "$NOW" --json > /out/pr-$n.$name.json 2>/out/pr-$n.$name.stderr
    echo "pr-$n $name exit $? started $started finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  done
done
