# LEXP: the end of exposure time, and found_at from the first run that saw the fix

Lane LEXP, from main 10e5963892f63733489eca97f4eeb4dcc88deb3b, for docs/status.md "Missing before complete", item 2: "the exposure-time end (the merge is not recorded), found_at from the first run that saw the fix rather than the run's lookup". The definitions were committed first (definitions.md, commit 501d4b7), then the tests (b8d7127), then the code (d6f1fba).

## What is built

- **The merge is recorded.** The template (action/patch-workflow.yml) also runs on `pull_request` `closed`. Its fourth job, `merged` (`pull-requests: write` only, no checkout), runs `ludion deliver merged` for a merged PR from a `ludion/` branch. For a PR by `github-actions[bot]`, from this repository, into the default branch, whose body starts with Ludion's marker, it posts one comment, once: its first line is `<!-- ludion-merged {…} -->` with the record as JSON (the PR, its branch, GitHub's `merged_at` and merge commit, and the body's fix_published_at, found_at and applied_at), then a table with the hours from publication to the merge (the exposure time), from publication to found, and from found to the merge.
- **found_at is the first run that saw the fix.** When it decides, the check job writes what it saw (`ludion check --seen`, per key the advisory IDs, or an image's newer security releases and candidate) and uploads it as the artifact `ludion-seen` (90 days). The PR job, with `actions: read` added, walks back from its run through the workflow's runs (at most 100) and reads each record as untrusted data; the PR's Found row names the first run of an unbroken row whose valid record lists the fix, or says why it is this run's lookup.
- No state ref, secret, server or store of Ludion's: both read from and write to GitHub, in the user's repository.

## Tests (packages/cli/test, in Docker)

Docker: `node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413`, a copy of the read-only worktree in the volume `ludion-lexp-w`, `--memory 4g`, no Docker socket; `npm ci --ignore-scripts` with the network (scripts/install.sh), everything after it with `--network none` (scripts/run.sh, scripts/test.sh, scripts/full.sh, scripts/mutate.sh).

| Run | Head | Result |
|---|---|---|
| exposure, deliver, check and action-patch tests, before the code | b8d7127 (tests on 10e5963's code) | 27 failed, 107 passed (134) (`logs/red-10e5963.log`) |
| the same four files, with the code | d6f1fba | 134 passed (`logs/green2-d6f1fba.log`) |
| typecheck, build, every unit test | d6f1fba | typecheck exit 0, build exit 0, 45 files, 1933 passed, 25 skipped (`logs/typecheck-d6f1fba.log`, `logs/build-d6f1fba.log`, `logs/full-d6f1fba.log`) |
| mutations, each alone, the four files (scripts/mutate.sh) | d6f1fba | 24 applied: 19 caught, 5 survived (M6, M7, M22, M23, M24) (`logs/mutate-d6f1fba.log`) |
| the five again (scripts/mutate2.sh), after four tests were made stronger and M22 was aimed at the merged mode (its text had matched the judge mode's check first) | the next commit | 5 caught (`logs/mutate2.log`) |
| the four files, and typecheck, build and every unit test, with the stronger tests and the docs | the next commit | 134 passed; exit 0, exit 0, 1933 passed, 25 skipped (`logs/green3-final.log`, `logs/typecheck-final.log`, `logs/build-final.log`, `logs/full-final.log`) |

After the review of b5097c2 (PR comment 6554139186; definitions.md, section 5): six tests were added or extended to the four files (start.sh's mode merged on a self-hosted or unknown runner, B1; a padded deflated record over 1 MiB once inflated, N1; a deliver run whose records are all later than the receipt's lookup, N2; a body time and a `merged_at` with the form of a time but no date, N3; a re-run older run, N4; the walk's 5-minute limit, N7). The volume `ludion-lexp-w` was made again for this; each `docker run` was typed in full on the host (no host script), with `cat /sys/fs/cgroup/memory.peak` at its end.

| Run | Head | Result |
|---|---|---|
| the four files with the new tests, before the fix | 020f7db (tests on b5097c2's code) | 5 failed, 132 passed (137) (`logs/red-b5097c2.log`); the N1 and N2 tests pass there, as they pin what the code already does, and are checked by R4 and R5 below |
| the same, with the fix | 6859fca | 137 passed |
| mutations, each alone, the four files (scripts/mutate3.sh): the review's R4 (the inflated limit raised to 1 GiB) and R5 (`else if (true)`), and one or two per fix (F1 start.sh's runner check for mode merged removed; F2 and F3 the date checks of a body time and of `merged_at` removed; F4 the last record of the row taken again; F5 and F6 the walk's time limit removed, or checked only per page) | 6859fca | 8 applied: 8 caught, each by the test written for it (`logs/mutate3.log`) |
| the four files, typecheck, build, every unit test, and tools/records' test | 6859fca with these docs | 137 passed (`logs/green-fix1.log`); typecheck exit 0, build exit 0, 45 files, 1936 passed, 25 skipped (1961); records 14 passed (`logs/typecheck-fix1.log`, `logs/build-fix1.log`, `logs/full-fix1.log`, `logs/records-fix1.log`) |

After the review of 620aeae (PR comment 6554998194; definitions.md, section 6): main 4aefb22 was merged first (docs/status.md conflicted; the merge commit says how it was resolved). Then tests were added or extended in exposure.test.ts and deliver.test.ts: times that `Date.parse` rolls over to another date (`2026-02-30`, `2026-04-31`, `2026-11-31`, the hour 24) in a PR body, in `merged_at` and in a record's `checked_at`, N9; the walk's limit while the runs are listed, N10; the inflated limit, N11; the Found row's words after the limit, N13. The volume `ludion-lexp-w` was made again; each `docker run` was typed in full on the host, with `cat /sys/fs/cgroup/memory.peak` at its end.

| Run | Head | Result |
|---|---|---|
| the four files with the new tests, before the fix | ad3acd6 (tests on 620aeae's code, main merged) | 5 failed, 134 passed (139) (`logs/red-620aeae.log`); the N10 and N11 tests pass there, as they pin what the code already does, and are checked by Q6 and Q9 below |
| the same, with the fix | 3ea4bb9 | 139 passed (`logs/green-fix2.log`) |
| mutations, each alone, the four files (scripts/mutate4.sh): the review's Q6 (the check before each page removed) and Q9 (`maxOutputLength` removed), and one per fix (G1 the old check, `Date.parse` finite, everywhere; G2 to G4 the old check at a record's `checked_at`, a body time, `merged_at`; G5 the milliseconds not written out; G6 the old words) | 3ea4bb9 | 8 applied: 8 caught (`logs/mutate4.log`) |
| typecheck, build, `npm test`, and tools/records' test | 3ea4bb9 with these docs | typecheck exit 0, build exit 0, 45 files, 1938 passed, 25 skipped (1963); records 14 passed (`logs/typecheck-fix2.log`, `logs/build-fix2.log`, `logs/full-fix2.log`, `logs/records-fix2.log`) |

The 19 caught in the first pass were not run again against the stronger tests; the tests only gained assertions and cases. The shell that ran the first pass was stopped by the host for low memory while its container went on; the tally was read from the volume after the container exited (exit 0).

New tests: exposure.test.ts (the merge record, the walk, the Found row), deliver.test.ts (one: the PR gets the first run, and is opened with this run's lookup when the runs cannot be read), check.test.ts (the record, and check.sh's `--seen`), action-patch.test.ts (the template, action.yml and start.sh). The stand-ins are test/runs.ts (workflow runs, artifacts, the redirect to the zip) and stand-ins for the PR and comment API; no test reaches the network.

## Not done here

- No run on GitHub: the action has no release commit with its bundle. Whether GitHub starts the `pull_request` `closed` run when a person merges a PR opened with the workflow's token is not tested.
- Nothing computes the median exposure time from the merge records yet.
- The state ref, notification, the ignore list, the hourly cron and the push trigger (LB2b-next(2) and (3)).
