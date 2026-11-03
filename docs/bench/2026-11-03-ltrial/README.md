# LTRIAL: two runs of the whole path on ludion-trial (2026-11-03)

Definitions, committed before anything was placed in ludion-trial: docs/decisions/2026-11-03-ltrial-two-runs.md (80a5ec3 on lane/ltrial-two-runs, 2026-11-03T09:46:07Z). Result in short: docs/progress/2026-11-03-ltrial-two-runs.md. Times are UTC.

## What was placed in Ludion-ai/ludion-trial (private)

Every write went through the host's `gh api` (scripts/place.sh); no token went into a container. No repository setting, branch protection or secret was changed, and no PAT or GitHub App was used. No tag, no release, nothing published.

| Commit | Branch | What |
|---|---|---|
| a0fbdef417cd89d450c3997a997d9e2754de621e | ludion-action-3d143fe (new) | root commit: action.yml, action/ (without build.ts), packages/cli/dist/cli.js, action/dist/record.js, LICENSE, BUILD.md |
| 3faf98650ccb001cb38a9465edd8fd7a08618020 | main (was 2341948, logs/main-before.txt) | npm-ltrial/ (examples/npm-security at 3d143fe, unchanged) and .github/workflows/ludion-ltrial.yml |

- **The code:** Ludion-ai/ludion main `3d143fe2a17bf06d9c03292b3bfe57e1b3178617`. Built by scripts/build.sh in Docker (`node@sha256:e7add2a4…`, logs/node-image.txt; Node v24.22.2, npm 11.19.1; `--memory 3072m`, no socket, no token): `npm ci --ignore-scripts`, `npm run build -w ludion-ai`, `node action/build.ts`, all exit 0 (logs/build-session.txt, logs/build-npm-ci.txt, logs/build-cli.txt, logs/build-action.txt).
  - cli.js sha256 `30467ee73a7f189897783938213bebaf139a21012c5ed5a3f30e6ffb420c63f5`, 720,261 bytes
  - record.js sha256 `c87b047a3f95ffd10f0c5dc1d57b8e4d997ee0222179a5c8cf3ddd47c7e0f699`, 121,157 bytes
  - Each blob GitHub answered equals `git hash-object --no-filters` of the built file (place.sh stops otherwise; logs/action-blobs.txt).
- **The workflow:** trial-files/ludion-ltrial.yml. Its difference from action/patch-workflow.yml at 3d143fe is logs/workflow-diff.txt, and is what the definitions list. No permission added. actionlint 1.7.12 in Docker: exit 0, no output (logs/actionlint.txt).
- **The repository as it stood,** read and not changed: `default_workflow_permissions` read, `can_approve_pull_request_reviews` true, all actions allowed, 0 secrets (logs/settings-actions-workflow-permissions.json, logs/settings-actions-permissions.json, logs/secrets-list.json).

## The two runs

| | Run 1 | Run 2 |
|---|---|---|
| Run id | [41614045680](https://github.com/Ludion-ai/ludion-trial/actions/runs/41614045680) | [41614487146](https://github.com/Ludion-ai/ludion-trial/actions/runs/41614487146) |
| Event, commit | workflow_dispatch, 3faf986 | workflow_dispatch, 3faf986 |
| created_at, updated_at | 09:48:44Z, 09:50:13Z | 09:52:03Z, 09:52:23Z |
| Conclusion | success | success |
| check | 09:48:49Z–09:49:16Z, success, `work=true` | 09:52:07Z–09:52:22Z, success, `work=false` |
| patch | 09:49:18Z–09:49:50Z, success, `Packed 1 applied fix` | skipped |
| pull-request | 09:49:53Z–09:50:12Z, success, `opened #8` | skipped |
| Raw | logs/run1-run-41614045680.json, logs/run1-jobs-41614045680.json, logs/run1-timing-41614045680.json, logs/run1-job-check-125842910471.txt, logs/run1-job-patch-125843142058.txt, logs/run1-job-pull-request-125843395932.txt | logs/run2-run-41614487146.json, logs/run2-jobs-41614487146.json, logs/run2-timing-41614487146.json, logs/run2-job-check-125844402981.txt |

- **Token permissions,** from each job's log: check `Contents: read`, `Metadata: read`, `PullRequests: read`; patch `Contents: read`, `Metadata: read`; pull-request `Contents: write`, `Metadata: read`, `PullRequests: write`. The repository has 0 secrets.
- **Annotations:** one notice per job that ran (the runner's ubuntu-latest migration), nothing from Ludion (logs/run1-annotations-check-125842910471.txt and its neighbours).
- **Logs of the skipped jobs:** GitHub answers HTTP 404 (logs/run2-job-patch-125844540446.err.txt, logs/run2-job-pull-request-125844541199.err.txt).
- **Actions caches:** 0 after both runs (logs/caches-after-run1.json, logs/caches-after-run2.json), though each job's log says `Cache mode: write`.
- **Other runs in the window:** PR #8 also made `ci`'s pull_request run 41614240851, `action_required`, no jobs (logs/runs-since-start.json). It was not approved. As before: GitHub starts no CI for a PR made with the workflow's token.

## The PR

[#8](https://github.com/Ludion-ai/ludion-trial/pull/8) `ludion: lodash 4.17.20 -> 4.18.1 (npm)`, open, created 09:50:08Z by github-actions[bot], base main, head `ludion/npm-ltrial/npm/lodash-4.18.1-8451466ef948` at `d94f806d7c3b9f1644695c5f1fc42cdc692fe8ed`, one parent 3faf986, author Ludion. It changes npm-ltrial/package.json (+6 −2) and npm-ltrial/package-lock.json (+5 −4) (logs/pr-8-after-run1.json, logs/pr-8-files.json, logs/pr-8-head-commit.json, logs/pr-8-body-after-run1.md). The package.json's other lines are reformatted too, as on 2026-10-30's PR #2: `scripts` and `dependencies` each take three lines (no pass mark; the PR job checks that this is what Ludion writes). 0 check runs and 0 commit statuses on its head. The body is the same after run 2 (`cmp`; logs/pr-8-body-after-run2.md).

## The receipt

logs/receipt-run1.json, from run 1's `ludion-fixes` artifact 13220367427 (unzipped in Docker; the bundle was not kept). Receipt `14b5d144-e027-4052-893c-b63d0128fdee`, outcome applied, one fix.

- **The table (`fixes[0].resolution`):** T `2026-04-01T21:01:20.458Z`, 1 requirement, one answer: `lodash@4.18.1` → 4.18.1, role `v`. `stopped_no_allowed` false, no `no_answer`. `assert`: youngest `lodash@4.18.1`, wait 72 hours until `2026-04-04T21:01:20.458Z`, age 5,172.8 hours, `t_before_push_less_wait` true, no waits, no problems.
- **The choice before it (`version_choice`):** the smallest fixed version, 4.18.0, is deprecated, so 4.18.1 was taken; same publisher account (jdalton), no provenance on either.
- **The judge:** `ready_except_build`. Its findings include `lodash@4.18.1 was published by jdalton, 4.17.20 by bnjmnt4n.` with effect `extend`.
- **Gate 3 as the receipt has it:** `baseline_passed` and `candidate_passed` true.

## The lines

scripts/lines.jq (jq 1.7.1 in Docker, no network) on the saved JSON gives logs/lines.json. Lists of PRs: logs/pulls-P0.json, logs/pulls-after-run1.json, logs/pulls-after-run2.json. Branches: logs/branches-before.json, logs/branches-after-run1.json, logs/branches-after-run2.json. Main: logs/main-after-run1.txt, logs/main-after-run2.txt.

**The three lists of PRs are edited:** logs/pulls-P0.json, logs/pulls-after-run1.json and logs/pulls-after-run2.json have PR 7's `body` replaced by `[removed: operational text not for the public record]`, because that PR's text belongs to a private repository's operation and not to a public record (scripts/remove-pr7-body.jq, in Docker). Every other field is what GitHub answered, compared in Docker; the files are now in jq's compact form. No number here read that value: scripts/lines.jq on the edited lists gives what logs/lines.json holds, byte for byte after its first line, which is a line of the session's memory check.

| Line | Result | From logs/lines.json |
|---|---|---|
| 1: 1 PR on the first run | **Passes** | New PRs `[8]`; base main; head under `ludion/npm-ltrial/`; github-actions[bot]; one parent, run 1's head; only files under the folder; 1 applied fix, lodash; pull-request job success |
| 2: the oldest table in the receipt | **Passes** | As above. Roles: `["v"]` only |
| The PR body holds the table (no pass mark) | **No** | No `resolution`, `oldest`, `最古` or the requirement in its 3,583 characters; it names the receipt by ID |
| 3: no second PR on the second run | **Passes** | The same 8 numbers; one PR on the branch, the head unchanged; the same 7 `ludion/` branches; run 2 success; main still 3faf986 |

How run 2 got there: `Ludion check: work=false: every due fix is fixed by an open Ludion PR (npm:lodash #8); 9 s.` So the PR job's own answer to an existing PR was not reached.

## Minutes

Each job's duration rounded up to a whole minute, skipped jobs 0: run 1: 27 s, 32 s, 19 s = 3; run 2: 15 s = 1; `ci`'s `action_required` run has no jobs. **4 minutes** in all. The timing API answered `billable.UBUNTU.total_ms` 0 for both (`run_duration_ms` 89000 and 20000), so it is recorded and not used. With the one job of 2026-11-01 (`ci`'s test, 10 s = 1), ludion-trial's November so far is 5 minutes, against the stop at 1,000 (half of an assumed 2,000; the plan cannot be read with this token, and other private repositories draw on the same allowance and are not counted).

## Memory (the session's rule)

logs/memory.txt has `available` before each container this lane started through its helper, up to the first commit of these records (14,758 to 14,958 MB; the line for 3,072 MB is 3,840). `memory.peak`: the build 1,134,891,008 bytes (logs/build-session.txt); unzipping the artifact 5,693,440; the records tests in Docker 526,864,384 and 351,367,168. The jq and actionlint containers have no shell step to read it, so theirs are not known (limits 256 MB).
