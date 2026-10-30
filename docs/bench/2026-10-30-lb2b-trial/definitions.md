# LB2b — definitions, fixed before the first run (2026-10-30)

Committed before any workflow exists in Ludion-ai/ludion-trial, so that nothing here is changed after a result is seen. The eight items are the brain's list (ludion-ops#1 comment 6520197748, "LB2b で確かめること"); the coordinator's brief for tonight stops at the first run. Nothing here changes a gate, the wait table or any rule of CLAUDE.md; these are measurement definitions only, so they are kept in this folder rather than in docs/decisions/.

## What runs

- Repository: Ludion-ai/ludion-trial (private, owned by the user account Ludion-ai; no secrets; Workflow permissions "read", "Allow GitHub Actions to create and approve pull requests" on, as the owner set them; Ludion does not change them).
- Ludion's code: Ludion-ai/ludion main 859d40f738330cbeafeb8e8cd930af33e4cb0b70 (#215 not merged). Built in Docker (node:24, Node 24.22.2, npm 11.19.1): `npm ci --ignore-scripts`, `npm run build -w ludion-ai`, `node action/build.ts`.
  - packages/cli/dist/cli.js sha256 `4a8a254aaeff655fd7ad22534081165bd9d24ed19983218685c7314c14171000`
  - action/dist/record.js sha256 `9f97925b69fe02fa48cf37ab1bccdf7182149a233c65ed35d4797b54a7cbb639`
- The built action sits only on the branch `ludion-action` of ludion-trial (a root commit: action.yml, action/, the two bundles, LICENSE, BUILD.md). Nothing built goes to Ludion-ai/ludion's main or to a tag; nothing is published.
- Samples on ludion-trial's main, copied unchanged from Ludion-ai/ludion's examples at 859d40f:
  - `php/` = examples/php-security (`FROM php:8.4.26-cli-alpine`, an old patch release);
  - `npm/` = examples/npm-security (lodash pinned at 4.17.20, a vulnerable version).
- Workflows on ludion-trial's main: `.github/workflows/ludion-php.yml` (dir `php`) and `.github/workflows/ludion-npm.yml` (dir `npm`). Each is action/patch-workflow.yml at 859d40f with only two kinds of change: the action is `Ludion-ai/ludion-trial@<the ludion-action commit's full SHA>`, and `dir` names the sample. Same cron (`23 */6 * * *`, UTC), same `workflow_dispatch`, same per-job permissions (patch: `contents: read`; pull-request: `contents: write`, `pull-requests: write`), same concurrency. Two workflows rather than one because each run's artifact is named `ludion-fixes`, and one ecosystem per project folder.

## 1. Schedule (one week)

- Window: from the first scheduled slot after the workflows land on ludion-trial's main, for 7 × 24 hours (28 slots per workflow, 56 in all).
- Slots: 00:23, 06:23, 12:23 and 18:23 UTC each day.
- A slot's run: the earliest run of that workflow with `event` = `schedule` whose `created_at` is at or after the slot and before the next slot. None: the slot is missed.
- Delay: the run's `created_at` minus its slot, in seconds. `run_started_at` is recorded too, not used for the delay.
- Reported, per workflow and for both: runs that came / slots planned, median and maximum delay (over the slots that ran), and each missed slot. A run that comes more than 6 hours late is counted against the later slot by this rule and the earlier slot as missed; it is listed by hand when that happens.
- Source: `GET /repos/Ludion-ai/ludion-trial/actions/runs`, raw JSON saved under logs/.
- No pass mark: this is a measurement.

## 2. One PR per fix

- Pass: after a workflow's first run, one PR per applied fix (one for `php/`, one for `npm/` while each sample has one fix); after its second run, still exactly one PR per fix branch (head ref), whatever its state, and the second run's PR job reports the existing PR (`open_pr_exists`) instead of opening one.
- Fail: two PRs with the same head branch, or a fix applied in the receipt with no PR.
- Source: `GET /repos/Ludion-ai/ludion-trial/pulls?state=all`, the PR job's log and step summary, saved under logs/.

## 3. CI on Ludion's PRs

Three forms, each with the permissions it adds: (a) nothing (expected: no CI, since GitHub starts no workflow for a PR made with `GITHUB_TOKEN`); (b) the PR job starts CI with `workflow_dispatch` using the same token (adds `actions: write`); (c) Ludion's result as a commit status (adds `statuses: write`). Recorded for each: whether the PR shows a green check, and the permission added. If none gives a green check, a GitHub App is the owner's decision. Not part of tonight's first run.

## 4. Permissions, from the run logs

- The validation job's log "GITHUB_TOKEN Permissions" block lists `Contents: read` and `Metadata: read` and nothing else; the repository has 0 secrets (`GET /repos/Ludion-ai/ludion-trial/actions/secrets`); start.sh did not stop on an OIDC request URL.
- The PR job's steps are only setup-node and the action's own steps (bundle check, checkout, download-artifact, `deliver open`); no step installs or runs the project's dependencies or tests.
- Pass: both hold in the first run's logs. Logs saved under logs/.

## 5. Waiting and failed fixes in the Actions screens

Recorded as seen: each run's and job's conclusion, the annotations (`::error::`, `::warning::`) and the step summary. Today `patch` exits 2 for a fix that waits as for one that fails (docs/bench/2026-10-30-lb-design), so the expected answer is "not told apart"; whether a stderr `::warning::` from `deliver open` becomes an annotation on GitHub is recorded too (LB2a's open question).

## 6. Actions minutes (private repository)

- Per run: each job's `completed_at − started_at`, rounded up to whole minutes per job (GitHub bills Linux jobs per started minute, ×1), summed. When `GET /repos/.../actions/runs/{id}/timing` answers, its `billable` is recorded next to it.
- Daily: the sum for runs created that UTC day, written to the progress record each day.
- Monthly free allowance: 2,000 minutes assumed (GitHub Free for a user account). The plan and the account's billing usage need the `user` scope, which the session's token does not have, so the plan is unconfirmed: the owner should confirm it. Ludion-ai's other private repositories (Tracecheck and others) draw from the same allowance and are not counted here.
- Stop: when the trial's minutes for the calendar month reach 1,000 (half of 2,000), or the month's projection (minutes so far ÷ days elapsed × days in the month) reaches 1,000, the trial workflows are disabled (`gh workflow disable`, which changes no repository setting) and it is reported.

## 7. Lockfile rebuilt from the plan (if possible)

Counted only, never used for a product decision: in the PR job's position, whether `npm install --package-lock-only` from the plan reproduces the artifact's package-lock.json byte for byte. Not part of tonight's first run.

## 8. Exposure time, read only

A read-only script (scripts/exposure.jq) takes the PR list JSON saved by the host's `gh api` (no token in any container) and prints, per Ludion PR (body starting `<!-- ludion-fix -->`): the body's `Fix published` time, `created_at`, `merged_at`, and the differences published→PR and PR→merge in hours. It runs in Docker (jq). A PR with `Fix published` unknown, or not merged, has that difference as null.
