#!/bin/sh
# Inputs as judge.yml takes them: before = the first parent of refs/pull/N/merge, after = that merge commit,
# files = git diff --no-renames --name-only between them. Each changed <dir>/package.json is added on both sides.
# Run on the host from the checkout (git show only: files are written as data, nothing is run).
set -eu
[ -n "${1:-}" ] || { echo "usage: sh extract.sh <empty output dir outside the checkout> PR..."; exit 2; }
T="$1"; shift
for n in "$@"; do
  git fetch -q --no-tags origin "+refs/pull/$n/merge:refs/ludion/l9-merge-$n"
  merge=$(git rev-parse "refs/ludion/l9-merge-$n")
  read -r _ base head rest <<EOT
$(git rev-list --parents -n 1 "$merge")
EOT
  echo "pr-$n merge $merge base $base head $head"
  mkdir -p "$T/pr-$n/before" "$T/pr-$n/after"
  git diff --no-renames --name-only "$base" "$merge" > "$T/pr-$n/files"
  for f in package.json package-lock.json $(grep '/package\.json$' "$T/pr-$n/files" || true); do
    mkdir -p "$T/pr-$n/before/$(dirname "$f")" "$T/pr-$n/after/$(dirname "$f")"
    git show "$base:$f" > "$T/pr-$n/before/$f"
    git show "$merge:$f" > "$T/pr-$n/after/$f"
  done
done
cd "$T" && find . -type f | sort | xargs sha256sum
