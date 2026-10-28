#!/usr/bin/env bash
# action.yml, mode judge: reads the PR's package.json and package-lock.json, and each changed */package.json (a
# workspace's), at the test merge commit and at its base, and the files the merge changes, through the API with the
# job's read-only token. They are data: nothing is checked out, installed or run.
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

# Every path the merge adds, changes or removes, and both paths of a rename, as `git diff --no-renames` lists them.
# The compare API lists at most 300 files, so a change of 300 or more cannot be judged.
mkdir -p "$INPUT/before" "$INPUT/after"
gh api "repos/${REPO}/compare/${base}...${MERGE_SHA}" > "$INPUT/compare.json"
count=$(jq '.files | length' "$INPUT/compare.json")
if [ "$count" -ge 300 ]; then
  echo "::error::The PR changes ${count} or more files; the compare API lists at most 300, so its changed files are not known."
  exit 1
fi

# One file at one commit, raw, into a side's folder at the same relative path. Each path segment is URL-encoded.
get() { # $1: path, $2: commit, $3: side
  local path
  path=$(jq -rn --arg p "$1" '$p | split("/") | map(@uri) | join("/")')
  mkdir -p "$INPUT/$3/$(dirname -- "$1")"
  gh api -H "Accept: application/vnd.github.raw+json" "repos/${REPO}/contents/${path}?ref=$2" > "$INPUT/$3/$1"
}
for file in package.json package-lock.json; do
  get "$file" "$base" before
  get "$file" "$MERGE_SHA" after
done

# Each changed */package.json, on each side whose commit has it (docs/decisions/2026-10-29-lp-rest-followups.md):
# the compare answer's status says which. A path with an empty, "." or ".." segment stops the read.
jq -j '.files[]
  | ((.filename | select(endswith("/package.json"))) as $f
      | (if (.status | IN("added", "renamed", "copied")) then empty else "before", "\u0000", $f, "\u0000" end),
        (if .status == "removed" then empty else "after", "\u0000", $f, "\u0000" end)),
    ((.previous_filename // empty | select(endswith("/package.json"))) as $p
      | "before", "\u0000", $p, "\u0000", (if .status == "copied" then "after", "\u0000", $p, "\u0000" else empty end))' \
  "$INPUT/compare.json" > "$INPUT/manifests"
while IFS= read -r -d '' side && IFS= read -r -d '' file; do
  case "/${file}/" in
    *//*|*/./*|*/../*)
      echo "::error::The changed path ${file//[[:cntrl:]]/} cannot be copied as data."
      exit 1
      ;;
  esac
  if [ "$side" = before ]; then get "$file" "$base" before; else get "$file" "$MERGE_SHA" after; fi
done < "$INPUT/manifests"

jq -j '.files[] | .filename, "\u0000", (.previous_filename // empty | ., "\u0000")' "$INPUT/compare.json" > "$INPUT/files"
echo "base=${base}" >> "$GITHUB_OUTPUT"
