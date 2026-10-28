#!/usr/bin/env bash
# action.yml, mode comment: posts the judgement that mode judge recorded, as one comment per PR that each new
# judgement updates. judge-comment.yml's script, for a judge workflow the user names.
#
# It reads the artifact as untrusted data (the judge workflow's run takes its workflow file from the PR), checks it
# against valid.jq, and comments only when the recorded head is the run's head and still the PR's head. The result of
# a head that changes .github/ is not trusted, since that head could have changed the judge workflow: what the head
# changes is read by its commit SHA, so a push while this job runs cannot hide it.
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

pr=$(jq -r '.pr' "$dir/record.json")
head=$(jq -r '.head_sha' "$dir/record.json")
if [ "$head" != "$RUN_HEAD" ]; then
  echo "::error::The judgement names head ${head}, but run ${RUN_ID} was for ${RUN_HEAD}. Nothing posted."
  exit 1
fi
info=$(gh api "repos/${REPO}/pulls/${pr}" --jq '"\(.state) \(.head.sha) \(.base.ref) \(.base.repo.default_branch) \(.head.repo.full_name // "-") \(.head.ref)"')
read -r state current base_ref default_branch head_repo head_ref <<< "$info"
if [ "$state" != "open" ] || [ "$current" != "$head" ]; then
  echo "PR #${pr} is ${state} at ${current}; this judgement is for ${head}. Nothing posted."
  exit 0
fi
# A PR into another branch was judged by that branch's judge workflow.
if [ "$base_ref" != "$default_branch" ]; then
  echo "PR #${pr} is into ${base_ref}, not ${default_branch}. Nothing posted."
  exit 0
fi
if [ "$head_repo" != "$RUN_REPO" ] || [ "$head_ref" != "$RUN_BRANCH" ]; then
  echo "::error::PR #${pr} is from ${head_repo} ${head_ref}, but run ${RUN_ID} was for ${RUN_REPO} ${RUN_BRANCH}. Nothing posted."
  exit 1
fi

# What the run's own head changes, read by its SHA: unlike the PR's file list, a later push cannot change it.
branch=$(jq -rn --arg ref "$base_ref" '$ref | @uri | gsub("%2F"; "/")')
gh api "repos/${REPO}/compare/${branch}...${RUN_HEAD}" > "$dir/compare.json"
refused=$(jq -r -f "$here/refuse.jq" "$dir/compare.json")

jq -r -s --arg run "$RUN_URL" --argjson refused "$refused" -f "$here/body.jq" "$dir/record.json" > "$dir/body.md"
jq -n --rawfile body "$dir/body.md" '{body: $body}' > "$dir/payload.json"
ids=$(gh api --paginate "repos/${REPO}/issues/${pr}/comments" \
  --jq '.[] | select(.user.login == "github-actions[bot]" and (.body | startswith("<!-- ludion-judge -->"))) | .id')
id=${ids%%$'\n'*}
if [ -n "$id" ]; then
  gh api -X PATCH "repos/${REPO}/issues/comments/${id}" --input "$dir/payload.json" > /dev/null
  echo "Updated the judgement comment on PR #${pr} (${head})."
else
  gh api -X POST "repos/${REPO}/issues/${pr}/comments" --input "$dir/payload.json" > /dev/null
  echo "Posted the judgement comment on PR #${pr} (${head})."
fi
