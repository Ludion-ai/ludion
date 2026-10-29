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
# The root files, and each changed */package.json on the sides whose commit has it.
for file in package.json package-lock.json $(git diff --no-renames --name-only "$base" "$merge" | grep '/package\.json$' || true); do
  if git cat-file -e "${base}:${file}" 2> /dev/null; then git show "${base}:${file}" > "$out/$(key "repos/${repo}/contents/${file}?ref=${base}")"; fi
  if git cat-file -e "${merge}:${file}" 2> /dev/null; then git show "${merge}:${file}" > "$out/$(key "repos/${repo}/contents/${file}?ref=${merge}")"; fi
done
# The compare answer, with each file's status as GitHub names it.
{
  printf '{"files":['
  git diff --no-renames --name-status "$base" "$merge" \
    | awk -F'\t' '{ s = ($1 == "A") ? "added" : ($1 == "D") ? "removed" : "modified"; printf "%s{\"filename\":\"%s\",\"status\":\"%s\"}", (NR > 1 ? "," : ""), $2, s }'
  printf ']}\n'
} > "$out/$(key "repos/${repo}/compare/${base}...${merge}")"
printf 'MERGE_SHA=%s\nBASE_SHA=%s\nHEAD_SHA=%s\n' "$merge" "$base" "$head" > "$out/shas.env"
