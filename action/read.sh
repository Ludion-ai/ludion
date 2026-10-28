#!/usr/bin/env bash
# action.yml, mode judge: reads the PR's package.json and package-lock.json, at the test merge commit and at its base,
# and the files the merge changes, through the API with the job's read-only token. They are data: nothing is checked
# out, installed or run.
set -euo pipefail

read -r base second rest <<< "$(gh api "repos/${REPO}/commits/${MERGE_SHA}" --jq '[.parents[].sha] | join(" ")')"
if [ "${second:-}" != "$HEAD_SHA" ] || [ -n "${rest:-}" ]; then
  echo "::error::The test merge commit ${MERGE_SHA} is not head ${HEAD_SHA} merged onto one base commit."
  exit 1
fi
# The base is on the base branch when the branch is that commit or ahead of it. The branch name is URL-encoded, but
# its slashes are kept: the compare API reads them as part of the name.
branch=$(jq -rn --arg ref "$BASE_REF" '$ref | @uri | gsub("%2F"; "/")')
status=$(gh api "repos/${REPO}/compare/${base}...${branch}" --jq '.status')
if [ "$status" != "identical" ] && [ "$status" != "ahead" ]; then
  echo "::error::The test merge commit's base ${base} is not on the PR's base branch (compare: ${status})."
  exit 1
fi

mkdir -p "$INPUT/before" "$INPUT/after"
for file in package.json package-lock.json; do
  gh api -H "Accept: application/vnd.github.raw+json" "repos/${REPO}/contents/${file}?ref=${base}" > "$INPUT/before/${file}"
  gh api -H "Accept: application/vnd.github.raw+json" "repos/${REPO}/contents/${file}?ref=${MERGE_SHA}" > "$INPUT/after/${file}"
done

# Every path the merge adds, changes or removes, and both paths of a rename, as `git diff --no-renames` lists them.
# The compare API lists at most 300 files, so a change of 300 or more cannot be judged.
gh api "repos/${REPO}/compare/${base}...${MERGE_SHA}" > "$INPUT/compare.json"
count=$(jq '.files | length' "$INPUT/compare.json")
if [ "$count" -ge 300 ]; then
  echo "::error::The PR changes ${count} or more files; the compare API lists at most 300, so its changed files are not known."
  exit 1
fi
jq -j '.files[] | .filename, "\u0000", (.previous_filename // empty | ., "\u0000")' "$INPUT/compare.json" > "$INPUT/files"
echo "base=${base}" >> "$GITHUB_OUTPUT"
