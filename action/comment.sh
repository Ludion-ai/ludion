#!/usr/bin/env bash
# action.yml, mode comment: posts the judgement that mode judge recorded, as one comment per PR that each new
# judgement updates. judge-comment.yml's script, in its order, for a judge workflow the user names.
#
# The PR comes from GitHub, not from the artifact: the open PR from the run's head repository and branch into the
# default branch, still at the run's head. The result of a head that changes .github/ is not trusted, since that head
# could have changed the judge workflow: what the head changes is read by its commit SHA, so a push while this job runs
# cannot hide it, and that head's artifact is never downloaded. Any other artifact is untrusted data (the judge
# workflow's run takes its workflow file from the PR): it must match valid.jq and name the same PR and head.
set -euo pipefail
here=$(dirname "$0")

if [ "$RUN_EVENT" != "pull_request" ]; then
  echo "Run ${RUN_ID} was for a ${RUN_EVENT} event, not a pull request. Nothing posted."
  exit 0
fi
if [ "$RUN_PATH" != "$JUDGE_WORKFLOW" ]; then
  echo "::error::Run ${RUN_ID} is of ${RUN_PATH}, not of ${JUDGE_WORKFLOW} (the judge-workflow input). Nothing posted."
  exit 1
fi

dir="$RUNNER_TEMP/ludion-comment"
mkdir -p "$dir"

# The PR, from GitHub: the open one from the run's head repository and branch into the default branch (a PR into
# another branch was judged by that branch's judge workflow), still at the run's head.
gh api -X GET "repos/${REPO}/pulls" -f state=open -f "head=${RUN_OWNER}:${RUN_BRANCH}" -f "base=${DEFAULT_BRANCH}" > "$dir/pulls.json"
found=$(jq -r --arg repo "$RUN_REPO" --arg ref "$RUN_BRANCH" -f "$here/pick.jq" "$dir/pulls.json")
read -r pr current <<< "$found"
if [ "$pr" = "-" ]; then
  echo "Not exactly one open PR from ${RUN_REPO} ${RUN_BRANCH} into ${DEFAULT_BRANCH}. Nothing posted."
  exit 0
fi
if [ "$current" != "$RUN_HEAD" ]; then
  echo "PR #${pr} is at ${current}; run ${RUN_ID} was for ${RUN_HEAD}. Nothing posted."
  exit 0
fi

# What the run's own head changes, read by its SHA: unlike the PR's file list, a later push cannot change it.
# Decided before the artifact is read, so the artifact of a head that changes .github/ is never downloaded. The branch
# name is URL-encoded, but its slashes are kept: the compare API reads them as part of the name.
branch=$(jq -rn --arg ref "$DEFAULT_BRANCH" '$ref | @uri | gsub("%2F"; "/")')
gh api "repos/${REPO}/compare/${branch}...${RUN_HEAD}" > "$dir/compare.json"
refused=$(jq -r -f "$here/refuse.jq" "$dir/compare.json")

if [ "$refused" = "true" ]; then
  jq -r -n --arg run "$RUN_URL" --arg head "$RUN_HEAD" --argjson refused true -f "$here/body.jq" > "$dir/body.md"
else
  # A re-run uploads the record again (overwrite), so read the newest one.
  artifact=$(gh api "repos/${REPO}/actions/runs/${RUN_ID}/artifacts?name=ludion-judgement" \
    --jq '[.artifacts[] | select(.expired | not)] | sort_by(.created_at) | last // empty | "\(.id) \(.size_in_bytes)"')
  if [ -z "$artifact" ]; then
    if [ "$CONCLUSION" = "cancelled" ]; then
      echo "Run ${RUN_ID} was cancelled before it recorded a judgement. Nothing posted."
      exit 0
    fi
    echo "::error::Run ${RUN_ID} (${CONCLUSION}) has no judgement artifact. Nothing posted."
    exit 1
  fi
  read -r artifact_id size <<< "$artifact"
  if [ "$size" -gt 8388608 ]; then
    echo "::error::The judgement artifact is ${size} bytes. Nothing posted."
    exit 1
  fi
  gh api "repos/${REPO}/actions/artifacts/${artifact_id}/zip" > "$dir/artifact.zip"
  unzip -p "$dir/artifact.zip" judgement.json | head -c 8388608 > "$dir/record.json"
  if ! jq -e -s -f "$here/valid.jq" "$dir/record.json" > /dev/null; then
    echo "::error::The judgement does not match its schema. Nothing posted."
    exit 1
  fi
  recorded=$(jq -r '"\(.pr) \(.head_sha)"' "$dir/record.json")
  if [ "$recorded" != "${pr} ${RUN_HEAD}" ]; then
    echo "::error::The judgement names PR and head ${recorded}, but run ${RUN_ID} was for PR #${pr} at ${RUN_HEAD}. Nothing posted."
    exit 1
  fi
  jq -r -s --arg run "$RUN_URL" --arg head "$RUN_HEAD" --argjson refused false -f "$here/body.jq" "$dir/record.json" > "$dir/body.md"
fi
jq -n --rawfile body "$dir/body.md" '{body: $body}' > "$dir/payload.json"
ids=$(gh api --paginate "repos/${REPO}/issues/${pr}/comments" \
  --jq '.[] | select(.user.login == "github-actions[bot]" and (.body | startswith("<!-- ludion-judge -->"))) | .id')
id=${ids%%$'\n'*}
if [ -n "$id" ]; then
  gh api -X PATCH "repos/${REPO}/issues/comments/${id}" --input "$dir/payload.json" > /dev/null
  echo "Updated the judgement comment on PR #${pr} (${RUN_HEAD})."
else
  gh api -X POST "repos/${REPO}/issues/${pr}/comments" --input "$dir/payload.json" > /dev/null
  echo "Posted the judgement comment on PR #${pr} (${RUN_HEAD})."
fi
