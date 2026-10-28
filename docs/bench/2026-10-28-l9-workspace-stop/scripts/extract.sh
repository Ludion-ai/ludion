#!/bin/sh
# For each PR: before = be86239 (the merge ref's first parent), after = the PR head (its tree equals the merge ref's).
set -eu
[ -n "${1:-}" ] || { echo "usage: sh extract.sh <empty output dir outside the checkout>"; exit 2; }
T="$1"
extract() { n=$1; base=$2; head=$3; ws=$4
  for f in package.json package-lock.json "$ws/package.json"; do
    mkdir -p "$T/pr-$n/before/$(dirname "$f")" "$T/pr-$n/after/$(dirname "$f")"
    git show "$base:$f" > "$T/pr-$n/before/$f"
    git show "$head:$f" > "$T/pr-$n/after/$f"
  done
  git diff --no-renames --name-only "$base" "$head" > "$T/pr-$n/files"
}
extract 161 be8623912df7a6bddbd5c113db33b1eb18fd9acb b5014ddae044f02288232f13b5d1863a3089bdb2 apps/worker
extract 162 be8623912df7a6bddbd5c113db33b1eb18fd9acb eedb106d75331a390ef8ade0d2e0b20c74d729da apps/site
sha256sum "$T"/pr-*/before/package-lock.json "$T"/pr-*/after/package-lock.json "$T"/pr-*/*/apps/*/package.json "$T"/pr-*/*/package.json | sed "s#$T/##"
cat "$T"/pr-*/files
