# LB2b2 — the hourly run, the early exit and three ways to get CI on Ludion's PRs: definitions (2026-10-31)

Fixed and committed before anything below is tried in Ludion-ai/ludion-trial, so that no definition or pass mark is changed after a result is seen. Measurement definitions for an experiment only: nothing here changes a gate, the wait table or a rule of CLAUDE.md.

- Asked for: ludion-ops#1 comment 6529705640, item 4 (the hourly cron and the early exit of a run with nothing to do, and whether that exit can be decided without an earlier run's artifact, audit 6529106910 finding 6; the three forms of CI on Ludion's PRs), from 6528291928 item 4 and 6520197748 ("LB2b で確かめること" 3).
- Continues LB2b (#226, docs/bench/2026-10-30-lb2b-trial/). Its definitions stay in force except where this file says otherwise.
- Starting point: Ludion-ai/ludion main 47a21a9f8b6b25c880d4f71e2b4e285676c504a7. Between 859d40f (what ludion-trial's `ludion-action` branch 5f740a5 was built from) and 47a21a9, packages/cli changed only in README.md and a test, so the bundled CLI is the same file (packages/cli/dist/cli.js sha256 `4a8a254aaeff655fd7ad22534081165bd9d24ed19983218685c7314c14171000`); action/patch-workflow.yml gained `package-manager-cache: false` (#227), which the trial's workflows take too.

## What changes in ludion-trial

Everything is in Ludion-ai/ludion-trial (private). Nothing in Ludion-ai/ludion's action/, action.yml or .github/ changes tonight; the changes the template would need are proposed in the progress record.

1. A new commit on `ludion-action`, child of 5f740a5, adds a prototype `mode: check` to action.yml (action/check.sh, action/check.jq; action/start.sh accepts the mode). The bundles are not rebuilt and stay the same blobs.
2. On main, one commit:
   - `ludion-php.yml` and `ludion-npm.yml`: cron `23 * * * *` (hourly, off the hour) instead of `23 */6 * * *`; a first job `check` (mode check); `patch` runs only when `check` does not answer `work=false`; `package-manager-cache: false` as in 47a21a9's template; all three jobs pinned to the new `ludion-action` commit.
   - `php-a/`, `php-b/`, `php-c/`: copies of `php/` (`FROM php:8.4.26-cli-alpine`), one per CI form, so that each form gets a PR of its own opened after the form's workflow exists.
   - `ludion-ci-a.yml`, `ludion-ci-b.yml`, `ludion-ci-c.yml`: the same three jobs for `php-a`, `php-b`, `php-c`, `workflow_dispatch` only (no schedule).
   - `ci.yml`: the trial's own CI, `on: pull_request` and `workflow_dispatch`; one job `test` (`contents: read`) that builds each `php*/` folder's Dockerfile and runs its `ludion.security.json` test (`php tests/smoke.php`) with `--network none`.
3. Nothing else: no repository or account setting, no branch protection, no secret, no PAT, no GitHub App. A form that would need one of those is not tried and is reported as the owner's decision.

## 1. The hourly schedule

- The 6-hourly week of LB2b (from 2026-10-30T18:23Z) ends at the commit that sets the hourly cron (`T_switch`, its committer date). Its slots before `T_switch` are counted by LB2b's definitions (item 1), the 18:23Z slot included.
- From `T_switch`: slots at HH:23 UTC, every hour, per workflow (`ludion-php`, `ludion-npm`). A slot's run: the earliest run of that workflow with `event` = `schedule` whose `created_at` is at or after the slot and before the next slot; none, the slot is missed.
- Delay: `created_at` minus the slot, in seconds (`run_started_at` recorded too, not used).
- Recorded per run: run id, `created_at`, `run_started_at`, delay, conclusion, each job's `started_at`/`completed_at`/conclusion, the check job's `work` answer and reason (its log), billed minutes (item 4).
- Required: at least two hourly runs per workflow recorded; as many as the session lasts. No pass mark for the delay: it is a measurement.

## 2. The early exit (a run with nothing to do)

The `check` job holds `contents: read` and `pull-requests: read` only, runs no dependency code (the bundled CLI's `ludion scan`, which reads manifest files as data and asks OSV and php.net, and `gh`/`git`/`jq`), and has no `actions` permission, so it cannot list or download any run's artifact. Its inputs are only:

- (i) the run's commit (checked out without credentials);
- (ii) the live answers of `ludion scan --dir <dir> --json` on that commit;
- (iii) the repository's open PRs and, for the PRs below, the compare API and their head commit's files (tarball through the API).

Finding keys of one scan: a PHP scan (top-level `candidate`) gives `php` when `candidate` is not null; a project scan (`checks`) gives `<ecosystem>:<package name>` for each finding (only findings of kind `vulnerability` when the result has `fixed_versions_note`, as packages/cli/src/security/scan.ts `vulnerable` does). A scan with a check `error`, a result with status `incomplete`, or a non-empty `unsupported` gives no keys and makes the answer `work=true`.

`work=false` only when one of these is proven:

- A. `ludion scan` exits 0 on the run's commit (nothing found); or
- B. it exits 1 with keys, and every key K is covered: there is an open PR whose head is in this repository, whose head ref starts with `ludion/`, opened by `github-actions[bot]`, such that
  - `compare/<run's commit>...<head>` answers, and either `behind_by` is 0 or `compare/<merge base>...<run's commit>` lists no file under `<dir>/` (and fewer than 300 files), so the PR head's folder is this commit's folder plus the PR's change; and
  - `ludion scan` on the head's `<dir>` exits 0 or 1, gives keys without an error, and K is not among them.

Anything else, any command or API error included, is `work=true`, and `patch` runs as before. When the check job fails, `patch` runs too (`!cancelled() && needs.check.outputs.work != 'false'`). Known costs, recorded and not fixed tonight: a fix that waits, fails or is blocked has no open PR, so every hourly run with it does the full Docker run; a closed Ludion PR does not cover its key (deliver does not reopen it either, so that full run opens nothing).

Cases, with the answer expected before they run:

- E1. The hourly runs of `ludion-php` and `ludion-npm` while PRs #1 (`php`) and #2 (`npm:lodash`) are open and `php/`, `npm/` are unchanged: `work=false` (B), `patch` and `pull-request` skipped.
- E2. A forged earlier artifact: a dispatched run of `ludion-ci-a.yml` with input `forge=true` runs only a job that uploads an artifact named `ludion-fixes` whose receipt says there are no fixes. The next dispatched run of `ludion-ci-a.yml` must answer `work=true` (`php` on `php-a/`, no PR) and open the PR for `php-a/`. Fail: `work=false`, or no PR.
- E3. The run of `ludion-ci-a.yml` after E2's PR is open: `work=false` (B).
- E4. Seconds and minutes of an early exit: the check job's `completed_at − started_at`, and the run's billed minutes, for every early-exit run.

Pass for "decided without an earlier run's artifact": E1, E2 and E3 give the expected answer, and the check job's log shows no artifact request (it has no `actions` permission, which the job's "GITHUB_TOKEN Permissions" block in the log shows).

## 3. Three forms of CI on a Ludion PR

The trial's CI is `ci.yml` (above). For each form, one PR that Ludion opens on a folder of its own after the form's workflow is on main:

- Form A, nothing added (`ludion-ci-a.yml`, `php-a/`): the PR job is the template's (`contents: write`, `pull-requests: write`). Expected: no CI run, because GitHub starts no workflow for events made with `GITHUB_TOKEN`.
- Form B, the PR job starts CI with `workflow_dispatch` (`ludion-ci-b.yml`, `php-b/`): the PR job also has `actions: write`; after the action's step, a step runs `gh workflow run ci.yml --ref <branch>` for each PR from `ludion/php-b/` opened during this job.
- Form C, Ludion's result as a commit status (`ludion-ci-c.yml`, `php-c/`): the PR job also has `statuses: write`; after the action's step, a step posts a status (`state=success`, context `ludion`, the run's URL) on the head commit of each PR from `ludion/php-c/` opened during this job. This attaches Ludion's own validation (the project's test passed on old and new in Docker, checked again by `deliver open`), not the project's CI.

"Green on the PR", per form: at least 10 minutes after the PR is opened (and after any CI run started for it has completed), `gh pr view <n> --json statusCheckRollup` lists at least one entry, and every entry is a check run with conclusion `SUCCESS` or a status with state `SUCCESS`. Recorded with it: the head commit's check runs and statuses (API, raw JSON), whether any `pull_request` run of `ci.yml` was created for the PR, the run ids and URLs, and the permission the form added. Whether the green comes from the project's own CI (A, B) or from Ludion's status (C) is said for each. A required check under branch protection is not tried (that is a setting).

If no form gives a green PR, a GitHub App is the owner's decision; none is created.

## 4. Actions minutes

As LB2b's item 6: per job `completed_at − started_at` rounded up to whole minutes, skipped jobs 0, summed per run and per UTC day; the run timing API's `billable` recorded next to it. Monthly allowance assumed 2,000 (unconfirmed, as in LB2b); stop at 1,000 for the calendar month or a month's projection of 1,000 (minutes so far ÷ days elapsed × days in the month), by `gh workflow disable`. Also reported, not a stop rule: the projected minutes of a month of hourly runs with nothing to do (24 × days × billed minutes of an early-exit run, per workflow).

## Records

Results in docs/progress/2026-10-31-lb2b2-trial-ci.md and docs/bench/2026-10-31-lb2b2/ (raw JSON and logs from the host's `gh api`; no token in any container).
