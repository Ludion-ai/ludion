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
    node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error(`::error::The judge needs Node 22 or later; this runner has ${process.versions.node}.`); process.exit(1); }'
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
  patch|pull-request|check)
    # The scheduled workflow's jobs (action/patch-workflow.yml): on a schedule or by hand, on the default branch.
    # A scheduled run is always on the default branch; a dispatched one names its branch.
    if [ "$EVENT" != "schedule" ] && [ "$EVENT" != "workflow_dispatch" ]; then
      echo "::error::mode ${MODE} runs on schedule or workflow_dispatch, not ${EVENT}."
      exit 1
    fi
    if [ "$EVENT" = "workflow_dispatch" ] && [ "$REF" != "refs/heads/${DEFAULT_BRANCH}" ]; then
      echo "::error::mode ${MODE} runs on the default branch (${DEFAULT_BRANCH}), not ${REF}."
      exit 1
    fi
    # The split between the job that runs candidate code and the job that writes holds only when each job gets a fresh
    # machine: on a self-hosted runner, a sandbox escape in mode patch could stay for the job that holds the write token.
    if [ "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ]; then
      echo "::error::mode ${MODE} runs only on GitHub-hosted runners (a fresh machine per job), not on ${RUNNER_ENVIRONMENT:-an unknown runner}."
      exit 1
    fi
    if [ "$MODE" = "patch" ]; then
      # The job that runs candidate code holds no secret: an OIDC token request means id-token: write was granted.
      if [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ]; then
        echo "::error::mode patch runs candidate code and must hold no secret, but this job may request an OIDC token (id-token: write). Give it contents: read only."
        exit 1
      fi
      need node git docker jq
    elif [ "$MODE" = "check" ]; then
      # check runs before Docker: the bundled CLI, gh for the open PRs and their heads, tar, awk.
      need node git gh tar awk
    else
      need node git
    fi
    node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error(`::error::Ludion needs Node 22 or later; this runner has ${process.versions.node}.`); process.exit(1); }'
    ;;
  merged)
    # The template's merged job (action/patch-workflow.yml), when a PR is closed: it reads the PR through the API and
    # posts one comment; nothing from the PR is checked out or run (docs/bench/lexp/definitions.md, section 2).
    if [ "$EVENT" != "pull_request" ]; then
      echo "::error::mode merged runs on pull_request, not ${EVENT}."
      exit 1
    fi
    need node
    node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error(`::error::Ludion needs Node 22 or later; this runner has ${process.versions.node}.`); process.exit(1); }'
    ;;
  *)
    echo "::error::mode must be judge, comment, patch, pull-request, check or merged."
    exit 1
    ;;
esac
