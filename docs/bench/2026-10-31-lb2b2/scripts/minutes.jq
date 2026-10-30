# LB2b2, read only (docs/decisions/2026-10-31-lb2b2-trial-definitions.md, item 4): billed minutes per run from the jobs
# JSON the host's gh saved (GET /repos/Ludion-ai/ludion-trial/actions/runs/{id}/jobs), one file per run.
# Each job that ran (not skipped) counts its completed_at − started_at rounded up to whole minutes; skipped jobs 0.
# Usage (Git Bash needs MSYS_NO_PATHCONV=1):
#   docker run --rm -v "$PWD":/b -w /b ghcr.io/jqlang/jq:1.7.1 -s -f scripts/minutes.jq logs/jobs-*.json
def secs: (.completed_at | fromdateiso8601) - (.started_at | fromdateiso8601);
[.[] | {run: (.jobs[0].run_id), jobs: [.jobs[] | select(.conclusion != "skipped")
    | {name, conclusion, seconds: secs, minutes: ((secs / 60) | ceil | if . < 1 then 1 else . end)}]}
  | . + {minutes: ([.jobs[].minutes] | add // 0)}]
| {runs: ., total_minutes: ([.[].minutes] | add // 0)}
