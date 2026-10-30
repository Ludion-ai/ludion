# LB2b — the scheduled workflow and one PR per fix, on GitHub (ludion-trial)

Start: main 859d40f738330cbeafeb8e8cd930af33e4cb0b70 (#215 not merged). Definitions, committed before the first run: [definitions.md](definitions.md) (35774a8 on lane/lb2b-trial, 2026-10-30T14:54:36Z). Tonight's brief stops at the first run of each workflow; the week-long items continue.

## What was placed in Ludion-ai/ludion-trial (private)

All writes went through the host's `gh api` (contents API for the first file, then Git blobs, trees, commits and refs); no token went into a container, and no repository setting, branch protection or secret was changed.

| Commit | Branch | What |
|---|---|---|
| f78507b | main | README.md (the repository was empty) |
| 5f740a5 | ludion-action | root commit: action.yml, action/ (without build.ts), packages/cli/dist/cli.js, action/dist/record.js, LICENSE, BUILD.md |
| 7a8585d | main | php/ and npm/ (examples/php-security and examples/npm-security at 859d40f, unchanged); .github/workflows/ludion-php.yml and ludion-npm.yml |

- The bundles were built in Docker (node:24: Node 24.22.2, npm 11.19.1; `npm ci --ignore-scripts`, `npm run build -w ludion-ai`, `node action/build.ts`). Their output is logs/build-npm-ci.log and logs/build.log, at the commit in logs/build-commit.txt; the exit codes (0, 0, 0) were echoed to the session's terminal and are not in those files. cli.js sha256 `4a8a254a…71000`, record.js `9f97925b…cb639` (full values in definitions.md). The Git blob IDs GitHub holds for both (e3b16e2, 0ed93f2) equal `git hash-object` of the built files.
- Each workflow is action/patch-workflow.yml at 859d40f with the action pinned to `Ludion-ai/ludion-trial@5f740a5a5d654818c12d64416eb065149cdd8a0f` and `dir` set to `php` or `npm`, plus two comment lines and the name (`ludion-php`, `ludion-npm`, which the schedule script matches runs by). The name and comments go beyond the "two kinds of change" in definitions.md; nothing else differs. actionlint 1.7.12 (Docker): exit 0 (logs/actionlint.log, run again after the review on the same files).
- The repository as the owner set it (read with the API, not changed): `default_workflow_permissions` read, `can_approve_pull_request_reviews` true, all actions allowed, 0 secrets (logs/settings-actions-workflow-permissions.json, logs/settings-actions-permissions.json, logs/secrets-list.json, read after the review).
- The scripts (scripts/schedule.jq, scripts/exposure.jq) were written after the definitions commit, while the first runs went on; they implement definitions.md and change nothing in it. After the fresh-context review (PR comment 6526136360), schedule.jq was changed before the first scheduled slot (18:23Z) so that a slot whose 6-hour window is still open counts as pending, not missed (definitions.md: a slot's run may come any time before the next slot), and so that it also gives the total for both workflows and lists the runs it does not count.

## The first run of each workflow (workflow_dispatch, 2026-10-30)

| | ludion-php | ludion-npm |
|---|---|---|
| Run | [41076179380](https://github.com/Ludion-ai/ludion-trial/actions/runs/41076179380) | [41076186488](https://github.com/Ludion-ai/ludion-trial/actions/runs/41076186488) |
| Created | 2026-10-30T14:57:00Z | 2026-10-30T14:57:02Z |
| Conclusion | success | success |
| patch job | 14:57:07Z–14:57:22Z, success; `Packed 1 applied fix` | 14:57:07Z–14:57:39Z, success; `Packed 1 applied fix` |
| Receipt | fa5fa47f…: PHP 8.4.26 → 8.4.27, `baseline_passed` and `candidate_passed` true, new digest `sha256:d8784155…` | 4c48da1d…: lodash 4.17.20 → 4.18.1 (4.18.0 skipped as deprecated), judge `ready_except_build` |
| pull-request job | 14:57:26Z–14:57:44Z, success; `php (ludion/php/php/8.4.27): opened #1` | 14:57:43Z–14:57:58Z, success; `lodash (ludion/npm/npm/lodash-4.18.1): opened #2` |
| PR | [#1](https://github.com/Ludion-ai/ludion-trial/pull/1) `ludion: PHP 8.4.26 -> 8.4.27 in Dockerfile`, changes php/Dockerfile only (+1 −1), created 14:57:41Z by github-actions[bot] | [#2](https://github.com/Ludion-ai/ludion-trial/pull/2) `ludion: lodash 4.17.20 -> 4.18.1 (npm)`, changes npm/package.json (+6 −2) and npm/package-lock.json (+5 −4), created 14:57:55Z |
| Checks on the PR's head | 0 check runs, combined status `pending` with 0 statuses | the same |
| Annotations | one notice per job (the runner's ubuntu-latest migration notice), nothing from Ludion | the same |

Raw data in logs/: run-*.json, jobs-*.json, timing-*.json, job-*-<job id>.log (job logs with terminal escape codes removed), receipt-*.json (from each run's ludion-fixes artifact, unzipped in Docker; the bundles were not kept), pr-1.json, pr-2.json, pulls-2026-10-30T1500Z.json, exposure-2026-10-30T1500Z.json, annotations-first-runs.tsv (run, check run, job, level, message), caches.json, commit-7a8585d.json. The jobs' step summaries were not saved or read: the REST API does not serve them.

## The eight items, after the first run

1. **Schedule:** not measured yet. The window starts at the first slot after 7a8585d landed (its committer date 2026-10-30T14:56:38Z, logs/commit-7a8585d.json; the same as `head_commit.timestamp` in logs/run-*.json), that is 2026-10-30T18:23Z, and ends after 28 slots per workflow. scripts/schedule.jq computes it (tested on made-up runs only).
2. **One PR per fix:** first half met: one PR for the one PHP fix and one for the one npm fix. The second run (expected `open_pr_exists`, no second PR) has not happened yet; the first scheduled run will be it.
3. **CI on the PR:** not tried. ludion-trial has no CI workflow yet, so the 0 check runs on #1 and #2 say nothing about form (a).
4. **Permissions: pass** by definitions.md's two conditions, with the cache note at the end of this item. The logs' "GITHUB_TOKEN Permissions" blocks: patch jobs `Contents: read`, `Metadata: read`; PR jobs `Contents: write`, `Metadata: read`, `PullRequests: write`. 0 repository secrets. start.sh passed (it stops when an OIDC request URL is present). The PR jobs' steps are setup-node and the action's own steps (start, bundle check, checkout, download-artifact, `deliver open`), with the judge-mode steps skipped; nothing installs or runs the project's dependencies or tests. Every job's log also says `Cache mode: write`, and setup-node ran with `package-manager-cache: true` (main's template does not turn it off; #215 does) — the repository had no Actions cache after the runs (`GET /repos/Ludion-ai/ludion-trial/actions/caches`: total_count 0, logs/caches.json; the logs' `Found in cache @ /opt/hostedtoolcache/...` lines are the runner's tool cache, not the Actions cache), but see the cache note in docs/bench/2026-10-30-lb-design.
5. **Waiting and failed fixes in the screens:** not seen yet: both fixes applied, so there was no waiting or failed fix to compare.
6. **Minutes:** by the definition (each job's duration rounded up to a whole minute): 1 + 1 + 1 + 1 = **4 minutes** for the two runs (raw job durations 15 s, 18 s, 32 s, 15 s). The timing API answered `billable.UBUNTU.total_ms` 0 for both runs (`run_duration_ms` 45000 and 57000), so it is recorded but not used. The plan and the account's usage need the `user` scope (not held): unconfirmed.
7. **Lockfile rebuilt from the plan:** not tried.
8. **Exposure time:** scripts/exposure.jq ran (Docker, jq 1.7.1) on the saved PR list: #2 published→PR 5081.94 h (lodash 4.18.1 published 2026-04-01T21:01:20.458Z), #1 230.96 h (PHP 8.4.27, php.net's day 2026-10-21, as 00:00 UTC). Neither is merged, so PR→merge is null. These hours measure how old the samples' fixes were when the trial started, not how fast Ludion is.
