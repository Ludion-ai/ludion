#!/usr/bin/env bash
# Writes the judge-mode fixtures for run.sh from this repository's git: PR #161's test merge commit and its base, as the
# API would answer for them. Run on the host, from the repository root: prepare.sh <fixtures dir>.
set -euo pipefail
out=$1
mkdir -p "$out"
repo=Ludion-ai/ludion
git fetch -q origin refs/pull/161/merge:refs/ludion/pr161-merge
merge=$(git rev-parse refs/ludion/pr161-merge)
read -r _ base head <<< "$(git rev-list --parents -n 1 "$merge")"
key() { printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_'; }
printf '{"parents":[{"sha":"%s"},{"sha":"%s"}]}\n' "$base" "$head" > "$out/$(key "repos/${repo}/commits/${merge}")"
printf '{"status":"identical"}\n' > "$out/$(key "repos/${repo}/compare/${base}...main")"
for file in package.json package-lock.json; do
  git show "${base}:${file}" > "$out/$(key "repos/${repo}/contents/${file}?ref=${base}")"
  git show "${merge}:${file}" > "$out/$(key "repos/${repo}/contents/${file}?ref=${merge}")"
done
{
  printf '{"files":['
  git diff --no-renames --name-only "$base" "$merge" | sed 's/.*/{"filename":"&"}/' | paste -sd, -
  printf ']}\n'
} > "$out/$(key "repos/${repo}/compare/${base}...${merge}")"
printf 'MERGE_SHA=%s\nBASE_SHA=%s\nHEAD_SHA=%s\n' "$merge" "$base" "$head" > "$out/shas.env"
