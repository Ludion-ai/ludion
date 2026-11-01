#!/usr/bin/env bash
# action.yml, mode check: the scheduled workflow's first job (action/patch-workflow.yml). Decides, before Docker, whether
# this run has anything for patch to do (docs/bench/lb2b-next1/definitions.md). Its only inputs are the run's commit,
# the live answers of `ludion check` on it (the saved policy's ecosystem only) and the open PRs through the API. It never
# reads an earlier run's artifact (the job has no actions permission), so a forged receipt cannot quiet a fix.
# work=false only when proven: no fix, or every fix waits (its wait cannot have ended), is quiet (not new, and this slot
# does not double) or is fixed by an open Ludion PR whose head is this commit's folder plus its change. Anything else,
# an error included, is work=true and patch runs.
set -uo pipefail

answer() {
  echo "work=$1" >> "$GITHUB_OUTPUT"
  echo "Ludion check: work=$1: $2"
  echo "**Ludion check:** work=\`$1\`: $2" >> "$GITHUB_STEP_SUMMARY"
  exit 0
}

# The lines of file $1 that are not lines of file $2, whatever grep does with an empty pattern file.
minus() { awk -v drop="$2" 'FILENAME == drop { seen[$0] = 1; next } !($0 in seen)' "$2" "$1"; }
# The keys of one `ludion check` answer (file $1) in state $2.
keys() { awk -F '\t' -v s="$2" '$1 == "key" && $2 == s { print $3 }' "$1" | sort -u; }

scratch="$RUNNER_TEMP/ludion/check"
mkdir -p "$scratch"
started=$(date +%s)

# The folder as the compare API names files: no "./", no trailing "/"; "." for the root. Anything else is not decided.
dir=$DIR
while [ "${dir#./}" != "$dir" ]; do dir=${dir#./}; done
while [ "${dir%/}" != "$dir" ]; do dir=${dir%/}; done
[ -n "$dir" ] || dir=.
case "/$dir/" in
  */../*|*/./*|*//*) [ "$dir" = . ] || answer true "the folder ${dir} is not in a form this check compares." ;;
esac

# The commit's committer time: a later commit moves every fix's anchor. Without it, every fix that does not wait is due.
changed=$(git -C "$GITHUB_WORKSPACE" log -1 --format=%cI "$GITHUB_SHA" 2>/dev/null) || changed=""
if [[ "$changed" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}([+-][0-9]{2}:[0-9]{2}|Z)$ ]]; then
  node "$CLI" check --dir "$PROJECT" --changed-at "$changed" > "$scratch/main.txt"
else
  echo "The commit's time could not be read; every fix that does not wait is due."
  node "$CLI" check --dir "$PROJECT" > "$scratch/main.txt"
fi
status=$?
cat "$scratch/main.txt"
if [ "$status" != 0 ] || [ "$(head -n 1 "$scratch/main.txt" | cut -f 1)" != decided ]; then
  reason=$(awk -F '\t' '$1 == "undecided" { print $2; exit }' "$scratch/main.txt")
  answer true "ludion check could not decide (exit ${status}${reason:+: ${reason}})."
fi
outside=$(awk -F '\t' '$1 == "outside" { print $2 }' "$scratch/main.txt" | paste -sd',' | sed 's/,/, /g')
[ -z "$outside" ] || echo "Not checked by this workflow (its policy is $(head -n 1 "$scratch/main.txt" | cut -f 2)): ${outside}." >> "$GITHUB_STEP_SUMMARY"
keys "$scratch/main.txt" due > "$scratch/due.keys"
waiting=$(awk -F '\t' '$1 == "key" && $2 == "waits" { print $3 " until " $4 }' "$scratch/main.txt" | paste -sd',' | sed 's/,/, /g')
quiet=$(awk -F '\t' '$1 == "key" && $2 == "quiet" { print $3 " (next due " $4 ")" }' "$scratch/main.txt" | paste -sd',' | sed 's/,/, /g')
held="${waiting:+ waits: ${waiting}.}${quiet:+ quiet: ${quiet}.}"
if [ ! -s "$scratch/due.keys" ]; then
  if grep -q $'^key\t' "$scratch/main.txt"; then answer false "no fix is due on ${GITHUB_SHA:0:12}.${held}"; fi
  answer false "ludion check found no fix on ${GITHUB_SHA:0:12}."
fi
echo "Due on ${GITHUB_SHA:0:12}: $(paste -sd' ' "$scratch/due.keys")"

gh api --paginate "repos/$REPO/pulls?state=open&per_page=100" \
  --jq '.[] | "\(.number) \(.head.sha) \(.head.repo.full_name // "-") \(.user.login) \(.head.ref)"' > "$scratch/pulls" \
  || answer true "GitHub did not list the open PRs."

: > "$scratch/covered"
while read -r number head repo login ref; do
  [ "$repo" = "$REPO" ] && [ "$login" = "github-actions[bot]" ] && [ "${ref#ludion/}" != "$ref" ] || continue
  [[ "$number" =~ ^[0-9]+$ && "$head" =~ ^[0-9a-f]{40}$ ]] || continue
  # The PR head's folder must be this commit's folder plus the PR's change: no file under it changed since the merge base.
  if ! read -r behind base < <(gh api "repos/$REPO/compare/${GITHUB_SHA}...${head}" --jq '"\(.behind_by) \(.merge_base_commit.sha)"'); then
    echo "PR #${number}: GitHub did not compare it with ${GITHUB_SHA:0:12}; not counted."
    continue
  fi
  if [ "$behind" != 0 ]; then
    if ! gh api "repos/$REPO/compare/${base}...${GITHUB_SHA}" --jq '(.files | length), (.files[] | .filename, (.previous_filename // empty))' > "$scratch/moved"; then
      echo "PR #${number}: GitHub did not list what changed since its merge base; not counted."
      continue
    fi
    count=$(head -n 1 "$scratch/moved")
    # The compare API lists at most 300 files: that many may hide one under the folder.
    if ! [[ "$count" =~ ^[0-9]+$ ]] || [ "$count" -ge 300 ] || { [ "$dir" = . ] && [ "$count" -gt 0 ]; } \
      || awk -v p="${dir}/" 'NR > 1 && index($0, p) == 1 { found = 1 } END { exit !found }' "$scratch/moved"; then
      echo "PR #${number}: ${dir} may have changed on ${GITHUB_SHA:0:12} since the PR's merge base; not counted."
      continue
    fi
  fi
  rm -rf "$scratch/head" && mkdir -p "$scratch/head"
  if ! gh api "repos/$REPO/tarball/${head}" > "$scratch/head.tgz" || ! tar -xzf "$scratch/head.tgz" -C "$scratch/head" --strip-components=1; then
    echo "PR #${number}: its head's files could not be read; not counted."
    continue
  fi
  # The head's keys only: no fact is read for them.
  if ! node "$CLI" check --dir "$scratch/head/$dir" --keys-only > "$scratch/pr-${number}.txt" \
    || [ "$(head -n 1 "$scratch/pr-${number}.txt" | cut -f 1)" != decided ]; then
    echo "PR #${number}: ludion check could not decide on its head; not counted."
    continue
  fi
  keys "$scratch/pr-${number}.txt" due > "$scratch/pr-${number}.keys"
  # Each due fix of this commit that the PR's head no longer has is covered by this PR.
  minus "$scratch/due.keys" "$scratch/pr-${number}.keys" | sed "s/\$/ #${number}/" >> "$scratch/covered"
  echo "PR #${number} (${ref}, head ${head:0:12}): its head has $(wc -l < "$scratch/pr-${number}.keys") fixes: $(paste -sd' ' "$scratch/pr-${number}.keys")"
done < "$scratch/pulls"

cut -d' ' -f1 "$scratch/covered" | sort -u > "$scratch/covered.keys"
missing=$(minus "$scratch/due.keys" "$scratch/covered.keys" | paste -sd' ')
seconds=$(( $(date +%s) - started ))
[ -z "$missing" ] && answer false "every due fix is fixed by an open Ludion PR ($(sort -u "$scratch/covered" | paste -sd',' | sed 's/,/, /g'));${held} ${seconds} s."
answer true "due and not fixed by an open Ludion PR: ${missing};${held} ${seconds} s."
