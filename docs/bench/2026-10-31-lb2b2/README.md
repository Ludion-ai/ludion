# LB2b2 — raw data (2026-10-30/31, UTC)

Definitions: docs/decisions/2026-10-31-lb2b2-trial-definitions.md. Summary: docs/progress/2026-10-31-lb2b2-trial-ci.md.

Everything under logs/ was saved by the host's `gh api` (no token in any container): runs, jobs and timing JSON per run, each job's log (escape codes stripped), PR JSON, each PR head's check runs, statuses, check suites and GraphQL rollup, and the Actions settings (read only). The scripts read those files in Docker (ghcr.io/jqlang/jq:1.7.1).

- trial-files/: what ran in ludion-trial: the workflows on main at 0a425b5, and the diff of `ludion-action` 5f740a5..6055465 (the prototype mode check).
- scripts/minutes.jq: billed minutes per run (definitions item 4). Output for the dispatched runs: minutes-dispatched.json.
- scripts/hourly.jq: hourly slots per workflow (definitions item 1).

## Runs

| Run | Workflow | Event | Created | Jobs that ran (seconds) | Billed min |
|---|---|---|---|---|---|
| 41111195443 | ludion-php | workflow_dispatch | 18:57:00Z | check 12 | 1 |
| 41111199451 | ludion-npm | workflow_dispatch | 18:57:02Z | check 18 | 1 |
| 41111203225 | ludion-ci-a (forge=true) | workflow_dispatch | 18:57:04Z | forge 7 | 1 |
| 41111849216 | ludion-ci-a | workflow_dispatch | 19:02:14Z | check 12, patch 29, pull-request 11 | 3 |
| 41111854180 | ludion-ci-b | workflow_dispatch | 19:02:16Z | check 16, patch 25, pull-request 20 | 3 |
| 41111858567 | ludion-ci-c | workflow_dispatch | 19:02:18Z | check 10, patch 20, pull-request 15 | 3 |
| 41111994799 | ci (PR #3) | pull_request | 19:03:16Z | none (`action_required`) | 0 |
| 41111996801 | ci (PR #4) | pull_request | 19:03:16Z | none (`action_required`) | 0 |
| 41112014266 | ci (PR #5's branch) | workflow_dispatch | 19:03:24Z | test 14 | 1 |
| 41112018074 | ci (PR #5) | pull_request | 19:03:25Z | none (`action_required`) | 0 |
| 41112355250 | ludion-ci-a | workflow_dispatch | 19:05:42Z | check 20 | 1 |
| 41113821081 | ludion-ci-d | workflow_dispatch | 19:15:58Z | check 16, patch 21, pull-request 13 | 3 |
| 41113953218 | ci (PR #6's branch) | workflow_dispatch | 19:16:56Z | test 13, report 5 | 2 |
| 41113954193 | ci (PR #6) | pull_request | 19:16:57Z | none (`action_required`) | 0 |

Total 19 billed minutes (created 2026-10-30 UTC). The timing API's `billable.UBUNTU.total_ms` was 0 for every run. With LB2b's 4 minutes (14:57Z), the trial used 23 minutes on 2026-10-30 UTC.

An early exit is 1 billed minute (one job of 10–20 s). Two workflows hourly with nothing to do: 2 × 24 × 30 = 1,440 minutes in a 30-day month, more than the 1,000 that the stop rule allows (half of an assumed 2,000); one workflow, 720.

## PRs

| PR | Branch | Head | Opened | Form |
|---|---|---|---|---|
| #3 | ludion/php-c/php/8.4.27 | fe413c6b5f12d440a46da34e72cc9c4d1a66f22c | 19:03:09Z | C |
| #4 | ludion/php-a/php/8.4.27 | a49b67e9e146b99a3caa0ace683285f26d3995aa | 19:03:12Z | A (and E2) |
| #5 | ludion/php-b/php/8.4.27 | 3b4df82c05d57d0d0f9a9510beba23bc9d47a089 | 19:03:21Z | B |
| #6 | ludion/php-d/php/8.4.27 | 8f7eac28be7ba15e1258bd47ce8dde55bd137a88 | 19:16:54Z | B2 |

Each is one PR per fix branch (PHP 8.4.26 → 8.4.27, opened by github-actions[bot]); #1 and #2 (LB2b) are still open.
