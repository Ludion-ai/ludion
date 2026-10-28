#!/usr/bin/env bash
# action.yml, first step of either mode: checks the mode, the event and the tools. In mode judge it records
# "undecidable" from the start; only a judge that finished replaces that record.
set -euo pipefail

need() { for tool in "$@"; do command -v "$tool" > /dev/null || { echo "::error::${tool} is not on this runner."; exit 1; }; done; }

case "$MODE" in
  judge)
    # pull_request is the event whose github.sha is the test merge commit; pull_request_target's is the base.
    if [ "$EVENT" != "pull_request" ]; then
      echo "::error::mode judge runs on pull_request, not ${EVENT}."
      exit 1
    fi
    need gh jq node
    node -e 'if (Number(process.versions.node.split(".")[0]) < 20) { console.error(`::error::The judge needs Node 20 or later; this runner has ${process.versions.node}.`); process.exit(1); }'
    at=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
    echo "at=${at}" >> "$GITHUB_OUTPUT"
    mkdir -p "$(dirname "$RECORD")"
    jq -n --argjson pr "$PR" --arg head "$HEAD_SHA" --arg base "$BASE_SHA" --arg merge "$MERGE_SHA" --arg at "$at" \
      '{schema: 1, pr: $pr, head_sha: $head, base_sha: $base, merge_sha: $merge, started_at: $at,
        verdict: "undecidable", reason: "The judge did not finish; see the run log.", finished_at: null,
        judge_seconds: null, job_seconds: null, judge_exit_code: null, judgement: null, text: null}' > "$RECORD"
    ;;
  comment)
    if [ "$EVENT" != "workflow_run" ]; then
      echo "::error::mode comment runs on workflow_run, not ${EVENT}."
      exit 1
    fi
    need gh jq unzip
    ;;
  *)
    echo "::error::mode must be judge or comment."
    exit 1
    ;;
esac
