#!/usr/bin/env bash
# Runs on the host with gh only: saves one run's raw JSON and logs. Usage: collect.sh <run id> <label> <log folder>
set -uo pipefail
ID=$1; LABEL=$2; L=$3
R=Ludion-ai/ludion-trial
gh api "repos/$R/actions/runs/$ID" > "$L/$LABEL-run-$ID.json"
gh api "repos/$R/actions/runs/$ID/jobs" > "$L/$LABEL-jobs-$ID.json"
gh api "repos/$R/actions/runs/$ID/timing" > "$L/$LABEL-timing-$ID.json"
gh api "repos/$R/actions/runs/$ID/artifacts" > "$L/$LABEL-artifacts-$ID.json"
gh api --paginate "repos/$R/pulls?state=all&per_page=100" > "$L/pulls-after-$LABEL.json"
gh api --paginate "repos/$R/branches?per_page=100" > "$L/branches-after-$LABEL.json"
gh api "repos/$R/actions/caches" > "$L/caches-after-$LABEL.json"
gh api "repos/$R/commits/main" --jq .sha > "$L/main-after-$LABEL.txt"
gh api "repos/$R/actions/runs/$ID/jobs" --jq '.jobs[] | [.id, .name] | @tsv' | tr -d '\r' | while IFS=$'\t' read -r job name; do
  # The escape codes never reach a terminal: sed takes them out first.
  gh api --allow-escape-sequences "repos/$R/actions/jobs/$job/logs" 2>"$L/$LABEL-job-$name-$job.err.txt" | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's/\r$//' > "$L/$LABEL-job-$name-$job.txt"
  [ -s "$L/$LABEL-job-$name-$job.err.txt" ] || rm -f "$L/$LABEL-job-$name-$job.err.txt"
  gh api "repos/$R/check-runs/$job/annotations" --jq '.[] | [.annotation_level, .title, .message] | @tsv' > "$L/$LABEL-annotations-$name-$job.txt" 2>/dev/null
done
