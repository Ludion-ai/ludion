# 2026-11-01 — LEXP: the merge of Ludion's PR is recorded (the end of exposure time), and found_at is the first run that saw the fix

**Lane LEXP**, from main 10e5963, for docs/status.md "Missing before complete", item 2: "the exposure-time end (the merge is not recorded), found_at from the first run that saw the fix rather than the run's lookup". Definitions: docs/bench/lexp/definitions.md, committed before the tests and the code. Detail and logs: docs/bench/lexp/README.md. No decision record: no goal, scope, gate, wait or rule changes; the template gains a job and a trigger, and the PR job gains `actions: read`.

## What changed

- action/patch-workflow.yml: also on `pull_request` `closed`; a fourth job `merged` (`pull-requests: write` only, no checkout) for a merged PR from a `ludion/` branch; the check, patch and PR jobs do not run on that event; a merge's run has its own concurrency group; the PR job gets `actions: read`.
- action.yml: mode `merged` (`ludion deliver merged`); mode check uploads `ludion-seen`; mode pull-request passes `--run-id`. action/start.sh accepts mode merged on `pull_request` only. action/check.sh asks the CLI for the record (`--seen`, `--commit`) and says `seen=true` when it was written.
- packages/cli/src/security/check.ts: each key carries its advisory IDs (or an image's newer security releases and candidate); `seenRecord`; `ludion check --seen <file> --commit <sha>`. The answer is unchanged.
- packages/cli/src/security/deliver.ts: `firstSeen` (the walk), `unzipEntry`, the PR body's Found row, `recordMerge`, `ludion deliver merged`, `deliver open --run-id`.
- README.md and packages/cli/README.md (the scheduled workflow's jobs and Limits; receipts), docs/status.md (the scheduled workflow, item 2, the date line).

## Results

| Run | Head | Result |
|---|---|---|
| the four test files, before the code | b8d7127 | 27 failed, 107 passed (134) |
| the same, with the code | d6f1fba | 134 passed |
| typecheck, build, every unit test | d6f1fba | exit 0, exit 0, 1933 passed, 25 skipped |
| mutations, each alone | d6f1fba | 24: 19 caught, 5 survived |
| the 5 again, after four tests were made stronger and one mutation re-aimed | the next commit | 5 caught |

## After the review of b5097c2

A fresh-context review (PR comment 6554139186) asked for one change before merging (B1: mode merged accepted a self-hosted runner while the docs said every mode refuses one) and listed seven more. Fixed: B1 (start.sh refuses it in mode merged too), N3 (a body time or `merged_at` with the form of a time but no date: null, or not recorded, instead of throwing), N4 (found_at is the row's earliest record time, as definitions.md says, not the lowest run id's), N7 (the walk stops after 5 minutes, and the PR keeps the receipt's found_at and says why); tests added for N1 and N2; N5's bound on a forged or deleted record restated (found_at can also move earlier); N6 stated in the READMEs and status.md. N8 (CI's test job near its 15-minute limit) is in .github/, which this lane does not change. Detail: docs/bench/lexp/definitions.md, section 5, and docs/bench/lexp/README.md.

| Run | Head | Result |
|---|---|---|
| the four files with the new tests, before the fix | 020f7db | 5 failed, 132 passed (137) |
| the same, with the fix | 6859fca | 137 passed |
| mutations, each alone (R4, R5 from the review; F1 to F6 for the fixes) | 6859fca | 8: 8 caught |
| typecheck, build, every unit test | 6859fca | exit 0, exit 0, 1936 passed, 25 skipped |

## After the review of 620aeae

A second fresh-context review (PR comment 6554998194) found the fixes above right and asked for main to be merged: docs/status.md conflicted with main 4aefb22, which replaced "Missing before complete" with the conditions C1 to C16. Main was merged (no rebase); its form was kept, and this lane's sentences on the old item 2 went to the end of that item in "The former working list", marked as LEXP's. Then: N9 (a time `Date.parse` rolls over to another date, such as `2026-02-30T00:00:00Z`, is now no date: unknown in the merge record, `merged_at` not recorded, a record not valid); N13 (after the walk's limit the body says the earlier records were not used, not that they were not read); tests for N10 and N11; N12, section 5's count of cases. N14 (CI's test job near its 15-minute limit) is in .github/, which this lane does not change. Detail: docs/bench/lexp/definitions.md, section 6, and docs/bench/lexp/README.md.

| Run | Head | Result |
|---|---|---|
| the four files with the new tests, before the fix | ad3acd6 | 5 failed, 134 passed (139) |
| the same, with the fix | 3ea4bb9 | 139 passed |
| mutations, each alone (Q6, Q9 from the review; G1 to G6 for the fixes) | 3ea4bb9 | 8: 8 caught |
| typecheck, build, `npm test`, tools/records' test | 3ea4bb9 | exit 0, exit 0, 1938 passed, 25 skipped; 14 passed |

## After an audit of GitHub's clocks

An audit reported that on 2026-11-01 GitHub's API gave some stored times (PRs' `created_at`, runs' `run_started_at`) an hour later than the Date header of the same answer, and that this lane compared those times with the runner's clock as one clock. While run times were an hour later, every record would have been passed over in silence (the PR's Found row: "`0` records read"), and a `merged_at` an hour later would have been recorded once as the end. Whether `merged_at` was later too, and why, were not checked here. Now: the walk is not done when GitHub's start of this run is later than the runner's clock or than the Date of its answer; at a run whose times do not agree it stops, and the Found row says at which run and by how many minutes; a `merged_at` later than the Date of its answer or than the job's clock is recorded with `merged_at_doubt`, and no hours end at it; every merge record keeps `recorded_at` and `answer_date`. Detail: docs/bench/lexp/definitions.md, section 7, and docs/bench/lexp/README.md.

| Run | Head | Result |
|---|---|---|
| the four files with the new tests, before the fix | 18d940c, and 369d533 with e623489's deliver.ts | 9 failed, 138 passed (147), both |
| the same, with the fix | 2a6afdd | 147 passed |
| mutations, each alone (H1 to H15) | 369d533 | 15: 15 caught |
| typecheck, build, `npm test`, tools/records' test | 369d533 | exit 0, exit 0, 1946 passed, 25 skipped; 14 passed |

## After a rule on clocks

A rule was set: times of different clocks are not compared with no margin, the Date of the same answer is the upper bound, a record keeps GitHub's time and the runner's, and a disagreement is said, not dropped. The merge record already kept both. The Found row now does too (definitions.md, section 8): GitHub's start of the run that saw the fix, this run's times by GitHub and by the runner, and both times of any disagreement. What decides did not change. The comparisons with a runner's clock still have no margin, which the rule's first line asks against: a margin would loosen the bound on a forged `checked_at`, and the difference between the clocks has not been measured. docs/mistakes/2026-11-01-github-clock-shift-not-noticed.md records the mistake.

| Run | Head | Result |
|---|---|---|
| the four files with the new tests, before the fix | 67a684d | 15 failed, 134 passed (149) |
| the same, with the fix | after 113e916 | 149 passed |
| mutations, each alone (I1 to I19) | 113e916 | 19: 18 caught, I12 survived; a test added, I12 alone: caught |
| typecheck, build, `npm test`, tools/records' test | with these changes | exit 0, exit 0, 1948 passed, 25 skipped; 14 passed |

## Not done

- No run on GitHub (no release commit). Whether GitHub starts the merged job when a person merges a PR opened with the workflow's token is not tested.
- Not recorded: a fix that reaches the default branch any other way, a merge GitHub starts no workflow for, when production gets the fix.
- Nothing computes the median exposure time from the merge records yet.
