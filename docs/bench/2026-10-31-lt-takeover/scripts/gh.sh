#!/usr/bin/env bash
# Lane LT, the GitHub API part (docs/decisions/2026-10-31-lt-takeover-definitions.md §3, §5). Runs on the host with
# gh, GET only. Reads <dir>/repos.txt and <dir>/commits.tsv (written by lt.ts refs, names checked there and here),
# writes <dir>/gh-repos.tsv (repo, status, id, full_name, default_branch), <dir>/gh-compare.tsv (repo, commit,
# default_branch, compare status or error) and <dir>/gh-commit-times.tsv (repo, commit, committer date).
set -u
dir=$1
repo_re='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
branch_re='^[A-Za-z0-9._/-]+$'
err=$(mktemp)
status_of() { grep -o 'HTTP [0-9]*' "$err" | head -1 | sed 's/HTTP //'; }
wait_for_rate() {
  local left reset now
  left=$(gh api rate_limit --jq .resources.core.remaining 2>/dev/null || echo 0)
  if [ "${left:-0}" -lt 200 ]; then
    reset=$(gh api rate_limit --jq .resources.core.reset 2>/dev/null || echo 0); now=$(date +%s)
    echo "$(date -u +%FT%TZ) rate limit: $left left, waiting $(( reset - now + 30 )) s" >&2
    sleep $(( reset > now ? reset - now + 30 : 60 ))
  fi
}

: > "$dir/gh-repos.tsv.tmp"
n=0
while IFS= read -r repo; do
  [ -z "$repo" ] && continue
  [[ "$repo" =~ $repo_re ]] || { printf '%s\tbad name\t\t\t\n' "$repo" >> "$dir/gh-repos.tsv.tmp"; continue; }
  n=$((n + 1)); [ $((n % 100)) -eq 0 ] && { wait_for_rate; echo "$(date -u +%FT%TZ) repos $n" >&2; }
  if out=$(gh api "repos/$repo" --jq '[.id, .full_name, .default_branch] | @tsv' 2>"$err"); then
    printf '%s\t200\t%s\n' "$repo" "$out" >> "$dir/gh-repos.tsv.tmp"
  else
    printf '%s\t%s\t\t\t\n' "$repo" "$(status_of)" >> "$dir/gh-repos.tsv.tmp"
  fi
done < "$dir/repos.txt"
mv "$dir/gh-repos.tsv.tmp" "$dir/gh-repos.tsv"

: > "$dir/gh-compare.tsv.tmp"; : > "$dir/gh-commit-times.tsv.tmp"
n=0
while IFS=$'\t' read -r repo commit kind; do
  [ -z "$repo" ] && continue
  [[ "$repo" =~ $repo_re && "$commit" =~ ^[0-9a-f]{40}$ ]] || continue
  n=$((n + 1)); [ $((n % 100)) -eq 0 ] && { wait_for_rate; echo "$(date -u +%FT%TZ) commits $n" >&2; }
  line=$(awk -F '\t' -v r="$repo" 'tolower($1) == tolower(r) { print; exit }' "$dir/gh-repos.tsv")
  status=$(printf '%s' "$line" | cut -f2); full=$(printf '%s' "$line" | cut -f4); branch=$(printf '%s' "$line" | cut -f5)
  if [ "$status" != "200" ] || ! [[ "$full" =~ $repo_re && "$branch" =~ $branch_re ]]; then
    printf '%s\t%s\t%s\trepository %s\n' "$repo" "$commit" "$branch" "${status:-not read}" >> "$dir/gh-compare.tsv.tmp"
  elif cmp=$(gh api "repos/$full/compare/$branch...$commit" --jq .status 2>"$err"); then
    printf '%s\t%s\t%s\t%s\n' "$repo" "$commit" "$branch" "$cmp" >> "$dir/gh-compare.tsv.tmp"
  else
    printf '%s\t%s\t%s\tHTTP %s\n' "$repo" "$commit" "$branch" "$(status_of)" >> "$dir/gh-compare.tsv.tmp"
  fi
  if [ "$kind" = "malicious-tag" ]; then
    if [ "$status" = "200" ] && date=$(gh api "repos/$full/commits/$commit" --jq .commit.committer.date 2>"$err"); then
      printf '%s\t%s\t%s\n' "$repo" "$commit" "$date" >> "$dir/gh-commit-times.tsv.tmp"
    else
      printf '%s\t%s\terror\n' "$repo" "$commit" >> "$dir/gh-commit-times.tsv.tmp"
    fi
  fi
done < "$dir/commits.tsv"
mv "$dir/gh-compare.tsv.tmp" "$dir/gh-compare.tsv"; mv "$dir/gh-commit-times.tsv.tmp" "$dir/gh-commit-times.tsv"
rm -f "$err"
echo "$(date -u +%FT%TZ) gh done" >&2
