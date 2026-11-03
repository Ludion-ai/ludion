# LTRIAL: two runs of the whole path on ludion-trial, definitions (2026-11-03)

Fixed and committed before anything below is placed in Ludion-ai/ludion-trial, so that no definition or pass mark is changed after a result is seen. These are measurement definitions only: nothing here changes a gate, the wait table, the scope or a rule of CLAUDE.md. The results go to docs/progress/2026-11-03-ltrial-two-runs.md and docs/bench/2026-11-03-ltrial/.

Why: the last runs of the scheduled workflow on GitHub were on 2026-10-30 and 2026-10-31, and action.yml, action/, `deliver.ts`, `dependency-patch.ts` and `check.ts` have changed on main since; #275 (LOLD2) changed how an npm fix is resolved, and its record says no whole `ludion patch` ran with the new code. docs/status.md still says a second run "is not recorded yet".

## The code

- Ludion-ai/ludion main at the start: `3d143fe2a17bf06d9c03292b3bfe57e1b3178617` (`git ls-remote`, 2026-11-03). Every file placed in ludion-trial comes from this commit.
- Built in Docker only, from a clone of that commit in a Docker volume: `npm ci --ignore-scripts`, `npm run build -w ludion-ai`, `node action/build.ts`, in `node:24` with `--memory 3g`, no Docker socket and no token. The sha256 of `packages/cli/dist/cli.js` and `action/dist/record.js` go in the bench folder.

## What is placed in Ludion-ai/ludion-trial

The repository is private. Its settings are read, not changed; no secret, PAT or GitHub App is used or made. Every write goes through the host's `gh api`, and no token goes into a container.

- A new branch `ludion-action-3d143fe`, a root commit: action.yml, action/ (without build.ts), the two bundles, LICENSE, BUILD.md. No tag, no release, nothing published.
- One commit on main, adding:
  - `npm-ltrial/`: examples/npm-security at 3d143fe, byte for byte (lodash locked at 4.17.20);
  - `.github/workflows/ludion-ltrial.yml`: action/patch-workflow.yml at 3d143fe with only these differences: the three `uses:` lines of Ludion's action pin `Ludion-ai/ludion-trial@<the new branch's full SHA>`, `dir` is `npm-ltrial`, `name` is `ludion-ltrial`, the `schedule` trigger is left out (only `workflow_dispatch`: the owner had the schedule taken out of this repository's workflows on 2026-11-01, ludion-trial #7), and the comments at the top say so. The jobs' permissions are the template's. No permission is added.

A new folder and workflow because `npm/` already has an open PR (#2, 2026-10-30), which would make a first run find nothing to do. The other workflows and PRs #1 to #6 stay as they are.

## The two runs

- Both by `workflow_dispatch` on main, in PR mode as the template is (nothing merges). Each run has at most three jobs: `check`, `patch`, `pull-request`.
- Run 2 starts after run 1 has completed. Main of ludion-trial does not move between them, and the PR run 1 opens is not merged, closed or edited. If either happens anyway, the trial is reported as not valid for line 3 below.
- `P0` is the list of every PR of the repository (`GET /pulls?state=all`), saved before run 1. `P1` is the same list saved after run 1 has completed, `P2` after run 2 has completed.

## What counts

**Line 1, "1 PR on the first run".** Passes when all of these hold:

1. `P1` minus `P0` is exactly one PR.
2. That PR's base is `main`, its head branch starts with `ludion/npm-ltrial/`, and its author is `github-actions[bot]`.
3. Its head commit has one parent, run 1's `head_sha`, and it changes only files under `npm-ltrial/`.
4. Run 1's receipt (below) has exactly one fix with an outcome of applied, and it is that PR's package.
5. Run 1's `pull-request` job concluded `success`.

**Line 2, "the oldest table is in the receipt".** The receipt is the JSON of run 1's `ludion-fixes` artifact, read in Docker. Passes when the applied fix's entry has a `resolution` with: `t` a string; `requirements` of 1 or more; `stopped_no_allowed` false; no `no_answer`; `answers` with at least one answer whose `name` is the fix's package and whose `version` is the fix's new version; and an `assert` whose `problems` is empty.

The answers' roles are written down and have no pass mark. lodash has no dependencies, so this sample is expected to give only the role `v`: a pass here does not show that a version with the role `oldest` was chosen, or that a moved or added entry reached the PR job.

**The PR body** (asked for; no pass mark). Whether the PR's body holds the table: written down as yes or no, from a search of the saved body for `resolution`, `oldest`, `最古` and any requirement from the table. Read before the run: `pullRequestBody` at 3d143fe writes no field of `resolution`, and names the receipt by its ID, so the expected answer is no.

**Line 3, "no second PR on the second run".** Passes when all of these hold:

1. `P2` has the same PR numbers as `P1`.
2. Exactly one PR in `P2`, of any state, has that head branch, and its head SHA is what it was in `P1`.
3. The repository's `ludion/` branches are the same list after run 2 as after run 1.
4. Run 2 concluded `success`. A run that failed or was cancelled opens no PR for the wrong reason, so it does not pass this line.

Which way run 2 got there is written down from its log and has no pass mark: `check` answering `work=false` naming the PR (the expected way, since the open PR's head no longer has the fix, in which case `patch` and `pull-request` are skipped and the PR job's own refusal to open a second PR is not reached), or the PR job finding the existing PR.

**The row.** `real-run-opens-one-pr-and-no-second` in C6's table is said to pass only when lines 1, 2 and 3 all pass, and then only for the commit above: a later change to the Action or the CLI is not covered until it is run again.

## A run that fails

It is recorded as it is, and nothing in Ludion-ai/ludion's packages/ or action/ is changed for it; fixing it is another lane's. Run 2 is still started once after a failed run 1, and its result is recorded: a PR that first appears on run 2 does not pass line 1.

Another attempt is allowed only when the log shows the failure came from outside (a 5xx from OSV, the registry or GitHub, or GitHub never starting a job), at most two times in all. Each attempt keeps its own row, with its run id, and erases nothing. The same failure three times stops the work.

## What is written down

For each run: run id, URL, `created_at`, `updated_at`, conclusion, each job's start, end and conclusion, the token permissions in each job's log. The PR's number, URL, head SHA, changed files and body. The receipt. Annotations. The raw JSON and logs go under docs/bench/2026-11-03-ltrial/logs/.

## Minutes

As in docs/bench/2026-10-30-lb2b-trial/definitions.md, item 6: each job's duration rounded up to a whole minute, summed. The free allowance is assumed to be 2,000 minutes a month (the plan cannot be read with this token); the work stops and is reported at half of that for ludion-trial in the calendar month.

## What this does not show

- That a real project's fix works: the sample is one owned example with one package and no dependencies.
- CI on the PR, a schedule, or a merge: none of them is part of this.
- That another commit behaves the same.
