#!/usr/bin/env bash
# Runs split.mjs in Docker on decisions.md and progress.md as they are at <commit> (the move's base), after removing
# what an earlier run moved (out/split-report.json), so that a rerun after a merge of main starts clean.
# Run on the host from the repository root: bash docs/bench/2026-10-29-lp-rest/split.sh <commit>
set -euo pipefail
commit=$(git rev-parse --verify "$1^{commit}")
here=docs/bench/2026-10-29-lp-rest
if [ -f "$here/out/split-report.json" ]; then
  # Earlier moved files, by the names the earlier report lists.
  docker run --rm --network none -v "$(pwd -W 2>/dev/null || pwd):/repo:ro" node:24-slim \
    node -e 'for (const r of require("/repo/'"$here"'/out/split-report.json")) for (const f of r.list) console.log(`docs/${r.kind}/${f.file}`)' \
    | tr -d '\r' | while read -r f; do rm -f "$f"; done
fi
old=$(mktemp -d)
git show "${commit}:docs/decisions.md" > "$old/decisions.md"
git show "${commit}:docs/progress.md" > "$old/progress.md"
MSYS_NO_PATHCONV=1 docker run --rm --network none --read-only --user 1000:1000 \
  -v "$(pwd -W 2>/dev/null || pwd):/repo" -v "$(cd "$old" && (pwd -W 2>/dev/null || pwd)):/old:ro" -w /repo \
  node:24-slim node "$here/split.mjs" /repo /old/decisions.md /old/progress.md "$commit" "/repo/$here/out" \
  | tee "$here/out/split-run.txt"
rm -rf "$old"
