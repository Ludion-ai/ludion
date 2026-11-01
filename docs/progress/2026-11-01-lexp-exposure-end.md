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

## Not done

- No run on GitHub (no release commit). Whether GitHub starts the merged job when a person merges a PR opened with the workflow's token is not tested.
- Not recorded: a fix that reaches the default branch any other way, a merge GitHub starts no workflow for, when production gets the fix.
- Nothing computes the median exposure time from the merge records yet.
