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

## Not done

- No run on GitHub (no release commit). Whether GitHub starts the merged job when a person merges a PR opened with the workflow's token is not tested.
- Not recorded: a fix that reaches the default branch any other way, a merge GitHub starts no workflow for, when production gets the fix.
- Nothing computes the median exposure time from the merge records yet.
