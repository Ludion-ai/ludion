# The shadow on GitHub Actions: estimate and dry run (2026-10-29, SA)

The design is docs/decisions/2026-10-29-shadow-on-actions.md. This folder holds what it rests on: the PC recorder's measured growth, the estimate of storage, Actions minutes and cost, the permissions, a dry run of the workflow's own shell steps against a local repository, and the script that moves the PC's data to the branch.

Nothing here ran on GitHub. The workflow was not started, the branch `shadow-data` does not exist, and the PC's recorder was not stopped.

## 1. Measured: the PC recorder's first 9.35 hours

`scripts/measure-pc.sh`, read-only, over `C:\dev\ludion-shadow-data\data` at 2026-10-29T01:13:00Z, 9.35 h after the recorder's start (2026-10-28T15:51:48Z). Output: `logs/measure-pc.log`.
- **How it was run.** The log was made by the commands in that file, typed as one shell line before the file was written; the file records them.
- **What it runs.** `du`, `gzip`, `find`, and `measure-pc.mjs` (record types, bytes per hour, poll durations) with the host's Node. They use only Node's own modules and coreutils, read the directory, and were not run in Docker.

| | Value |
| --- | --- |
| Data directory | 58,581,507 bytes |
| Polls | 561 (one a minute), 42,829 feed entries, 441 watched changes |
| Poll duration | median 301 ms, p90 3,392 ms, p99 27,835 ms, max 67,362 ms |
| First-seen names (`baseline`) | 247, 8,796,338 bytes |
| Their seed versions (`lockfile` 868, `predecessor` 1,230) | 25,539,477 bytes |
| New versions (`new` 328, `retry` 97) | 14,678,373 bytes; 36,451 bytes per `new` record (with its file list) |
| Other captures (`created` 481, `change` 194, `deprecation` 17) | 199,076 bytes |
| Status lines | 73,007 bytes |
| OSV (one daily read) | 15 MAL- records, 49,440 bytes |
| `known/` | 9,245,477 bytes: 247 name files (mean 36,937, median 15,062, p90 99,414, max 384,202) and 481 `created` files (121,934) |
| gzip -6 ratio | captures 0.331 (46,161,970 → 15,259,830), `known/` 0.290 |

One weekday night (UTC 16:00 to 01:00) of one recorder: low confidence for the rates below.

## 2. Storage

Arithmetic on section 1; not a measurement of the shadow. The shadow needs captures for four weeks plus the longest wait, 336 h (counting file, sections 3 and 4): about 42 days.

None of these figures is a bound. The "every name first seen" rows bound only the seed, at the measured size per name. The new-version rate comes from one night and could be higher on other days.

| Item | Per day | 28 days | 42 days | How |
| --- | --- | --- | --- | --- |
| New versions | 37.7 MB | 1,055 MB | 1,582 MB | 14,678,373 B / 9.35 h × 24 |
| Seed of first-seen names, central | — | 306 MB | 306 MB | 139,011 B per name × 2,198 names (28.7% of 7,660 published in 28 days: shadow design, section 4) |
| Seed, if every name is first seen | — | 1,065 MB | 1,065 MB | every one of the 7,660 names seen |
| `known/`, central / every name | — | 81 / 283 MB | 81 / 283 MB | 36,937 B × 2,198 / 7,660 |
| Status, `created` and the rest | 0.7 MB | 20 MB | 29 MB | (73,007 + 199,076) B / 9.35 h × 24 |
| **Branch files, uncompressed, central** | | **1.46 GB** | **2.00 GB** | |
| **Every name first seen** | | 2.42 GB | 2.96 GB | |

- **The limit.** `MAX_BYTES` is 3,800,000,000, counted over the branch's files, uncompressed. The PC's 1,900,000,000 would be reached around day 40 in the central case, inside the 42 days. 3.8 GB leaves 28% over the "every name first seen" case. A higher new-version rate eats into that.
- **The repository on disk.** Git stores objects compressed. At the gzip ratio, the branch's files are about 0.66 GB (central) to 0.98 GB (upper) at 42 days.
  - **Rewrites.** Each hourly commit also rewrites `state.json` and the `known/` files of names that changed: 441 watched changes in 9.35 h × 36,937 B × 0.290 ≈ 12 MB a day before git's deltas: about 0.5 GB over 42 days, an estimate, not a bound. How much the deltas save on GitHub is **not known**.
  - **Total.** About 1.2 to 1.5 GB by these estimates, not a bound, against GitHub's recommended 10 GB. The repository is 28,954 KB today (GitHub API `size`).
- **GitHub's per-file limits.** A run's files stay far under 100 MB: about 1.6 MB of new versions an hour. The PC's day files are cut at 50,000,000 bytes by the seed script; its 2026-10-28 file is 46,161,970 bytes.
- **Cost to people who clone.** A plain `git clone` fetches every branch, so it would download the data branch too. `actions/checkout` fetches one ref and is not affected. `git clone --single-branch` avoids it. Deleting the branch after the shadow is the owner's call; agents never delete remote branches.
- **Downloads each hour, not stored.** The record job checks out all of `known/`: about 81 MB (central) to 283 MB (every name) by the end, so up to about 1.9 to 6.8 GB of transfer a day. Whether GitHub counts or limits that transfer for a public repository is **not known**.
- **The size count's listing.** The record job lists `runs/` alone through GitHub's recursive tree API, whose limits are 100,000 entries and 7 MB. `runs/` gains about five entries an hour. `known/created` gained 481 files in 9.35 h (about 50 an hour, `logs/measure-pc.log`), so a listing of the whole branch could have reached those limits within the shadow.
- **Artifacts.** One per run, kept 1 day: `state.json`, the changed `known/` files and the run's lines. That is about 3 to 4 MB an hour, so under 100 MB alive at a time. The dry run's 2-minute runs were 143,360 and 184,320 bytes.

## 3. Minutes and cost

| Item | Value | Source |
| --- | --- | --- |
| Public repository, standard runner | free: "Standard GitHub-hosted runners in public repositories" | [billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| This repository | public (`gh repo view`: `PUBLIC`), owned by a user account | GitHub API, 2026-10-29 |
| Minutes per run | about 50 for `record` (3,000 s of polls, plus checkouts and the image pull) and about 1 for `write`. Estimated, not measured on GitHub | workflow |
| Per 30 days | about 24 × 30 × 51 ≈ 36,700 minutes | arithmetic |
| If the repository were private | $0.006 a minute for Linux 2-core: about $220 a month, against $12 of included compute on GitHub Free | [billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Artifact storage | the billing page measures storage usage "For private repositories". For public ones it gives no number, so this is **not known**. GitHub Free includes 500 MB (shared with Packages), then $0.25 per GB-month | same |
| Job limits | 6 hours per job; 20 concurrent jobs on Free. The shadow holds one of them most of each hour | [limits](https://docs.github.com/en/actions/reference/limits) |
| API calls | 3 per run (tree listing, artifact listing, artifact download), against 1,000 an hour per repository for `GITHUB_TOKEN` | same |
| Docker Hub | each run pulls the image unauthenticated. Docker limits unauthenticated pulls per IP ([Docker](https://docs.docker.com/docker-hub/usage/pulls/)). Whether GitHub-hosted runners are exempt is **not known**: users report 429s on hosted runners ([discussion](https://github.com/orgs/community/discussions/130794)). The workflow tries three times, a minute apart | — |
| npm registry and OSV | the same reads as the PC, now from GitHub's addresses. Their rate limits are **not known** (shadow design, section 6) | — |

**GitHub's terms for Actions** ([additional products](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features)) exclude two things that bear on this:
- on GitHub-hosted runners, "any other activity unrelated to the production, testing, deployment, or publication of the software project";
- "Any activity that places a burden on our servers, where that burden is disproportionate to the benefits provided to users".

The shadow tests this project's judge, which is how this design reads the first clause. The owner chose Actions knowing this; whether GitHub agrees is **not known**.

## 4. Permissions

- **Top level:** none (`permissions: {}`).
- **`record`:** `contents: read`. No secret. Its checkouts keep no credential. Docker gets no host environment, and the code and driver are mounted read-only.
- **`write`:** `actions: read` and `contents: write`. It runs no Node, npm or Docker, and pushes only to `shadow-data`. main cannot be pushed to by this token: it requires the `test` and `protected-paths` checks and a reviewed PR, with administrators included (GitHub API, 2026-10-29). No ruleset applies to `shadow-data` (`rules/branches/shadow-data` is empty).
- **The repository's default** workflow permission is `read` (`actions/permissions/workflow`). Each job sets its own.
- **No secret is used**, so there is nothing for the owner to create. A separate data repository would need one: `GITHUB_TOKEN` cannot push to another repository. That is why the data lives on a branch here.

## 5. Dry run of the workflow's shell steps

`scripts/simulate.sh` cuts each step's `run:` script out of `.github/workflows/shadow.yml` and runs it against a local bare repository:
- **Containers.** Git, jq and tar run in a Debian container (`debian:bookworm-slim` by digest). The recorder runs through the workflow's own `docker run`, in the PC's image, with network.
- **Stand-ins.** `scripts/gh-stand-in.sh` answers the three GitHub API calls from the local repository. The checkouts are the git commands actions/checkout runs. In the record checkout, git runs as root and the simulation opens the files up, where on a runner the checkout already belongs to the container's user.
- **`RECORD_SECONDS`.** The simulation passes its own 120 s.

**Two runs, two logs.**
- **`logs/simulate-16cc675.log`** (2026-10-29T01:16:36Z to 01:20:53Z) is the full dry run of workflow blob `16cc675…`, before the review's fixes (#197's first review). The results below are from it.
- **`logs/simulate-eb09004-stopped.log`** (from 01:38:19Z) is the same dry run of the reviewed workflow, blob `eb09004…`. Claude Code ended it during run 2's recording because the system ran low on memory, and it was not restarted. Before that it reached:
  - the seed (783 files) and the second seed refused;
  - the new branch check, which counted 50,722,390 bytes under `runs/`;
  - run 1, two polls that captured nothing, committed as `state.json` and its status lines (2 files, a 10,240-byte artifact).
- **The rest is covered by tests.** The writer's refusals and the record job's checks after the fixes are covered by the 13 script tests (section 7), not by this dry run.

What the full dry run showed:
- **Seed.** The seed script pushed a copy of the PC's data: 778 files, 61,381,245 bytes. A second seed was refused.
- **Two runs of 120 s,** each two polls ending at the deadline, then committed.
  - **Run 1:** 7 files, a 143,360-byte artifact.
  - **Run 2:** 5 files, 184,320 bytes. It started from run 1's state: seq 140476708, then 140476978, then 140477193, with the feed start unchanged.
  - **Each run's start line** names the pinned commit, the frozen list's sha256, 7,660 names, `max_bytes` 3,800,000,000 and the bytes stored before it.
- **Refused by the writer:**
  - the same artifact again after the branch moved;
  - the artifact under another run id;
  - an artifact holding `.github/workflows/x.yml`;
  - an artifact holding a symbolic link at a `known/` path.
- **Accepted:** the same run with only the recorder's paths. The branch held no `.github` entry afterwards.
- **What it overlaps.** The dry run read the real feed from the PC's position while the PC kept recording, into a copy that was then deleted. It did not touch the PC's data.

**Not shown by the dry run:** the hosted runner's own behaviour, namely
- actions/checkout's sparse and blobless options,
- GitHub's tree listing,
- the artifact upload and download,
- the schedule's delays,
- a 50-minute run.

The first scheduled runs after the seed show these. They are the first real check.

## 6. Moving from the PC

The order is in the decision file, section 5. The command is below. The owner runs it in Git Bash on the PC after stopping the PC's container (`docker stop ludion-shadow-recorder`), from a checkout of this repository whose `origin` is Ludion-ai/ludion, with the owner's own git credentials:

```text
bash docs/bench/2026-10-29-shadow-actions/scripts/seed-data-branch.sh C:/dev/ludion-shadow-data/data origin 8a78b55940def8463a2401e7bdd38d7e6c7b604d
```

- **What it pushes.** `state.json` and `known/` at the root, and the PC's lines under `runs/pc-8a78b55/`. It cuts a day file over 50,000,000 bytes at line ends, and drops `.tmp` leftovers of a crash.
- **What it refuses.** A branch that already exists, or a remote it cannot read.
- **What it needs.** Only git and coreutils, as Git for Windows' bash has them; no jq. A remote name such as `origin` is turned into its URL in the checkout it runs in, because the push runs from a new repository. It stores the files' bytes as they are, whatever the user's `core.autocrlf`.
- **The PC's folder stays as it is.** It is the original, kept until the owner decides.
- **Tried on this PC** (`logs/seed-host.log`, 2026-10-29T01:33:49Z), the way the owner will run it:
  - **Setup.** Git Bash, git 2.55.0.windows.5, `core.autocrlf=true`, no jq, and `MSYS_NO_PATHCONV` unset. The remote was given as `origin` of a clone of a local bare repository, with a copy of the PC's data.
  - **Pushed.** 783 files. All 783 blobs equal the copy's bytes. A second run was refused.
  - **A synthetic 60 MB day file** was cut into parts of 49,999,490 and 11,189,400 bytes, which joined in name order equal the source. A `.tmp` file was dropped.

## 7. Tests

- **`packages/cli/test/shadow-workflow.test.ts`: 27 tests.** All 27 and tools/shadow's 35 passed in Docker with no network: a read-only root, user 1000, and node:24-slim by digest with git, jq and unzip added. Typecheck exit 0.
  - **Without those tools** the 13 script tests skip; in plain node:24-slim, 14 passed and 13 were skipped. In CI a missing tool fails them instead of skipping.
  - **Mutations.** `scripts/mutations.sh` (`logs/mutations.log`) turns off, one at a time, the writer's file-type check, its path check, its moved-branch check and the record job's root check. Each makes tests fail.
- **The workflow's shape:**
  - schedule only, one run at a time, no top-level permission;
  - no secret, and every action pinned by SHA;
  - the pinned recorder commit, image and limit;
  - `record` with `contents: read` only and no persisted credential;
  - `write` with `actions: read` and `contents: write`, no Node, npm or Docker, pushing only to the data branch, on top of the commit the record job read, with its path and file-type checks;
  - no step that makes a branch.
- **The workflow's own scripts,** cut out of the file and run by bash against a local bare repository, as on the runner, with a stand-in for `gh`:
  - **The writer commits:**
    - this run's files on top of the branch, keeping what was there;
    - an hour's lines when `state.json` did not change.
  - **The writer refuses, leaving the branch as it was, an artifact holding:**
    - a path the recorder never writes;
    - another run's directory;
    - a `.tmp` file;
    - a symbolic link;
    - no `state.json`, or one without a feed position.

    It also refuses another run's id, and a branch that moved.
  - **The record job's check** counts the bytes under `runs/` and moves `.git` out. It refuses:
    - a branch root with anything else;
    - a `state.json` without a feed start;
    - a truncated listing.
- **The driver:**
  - a poll a minute up to the deadline;
  - a poll running at the deadline finishes;
  - a stop at the limit ends the run (exit 3);
  - failed polls are error lines (exit 4 when none succeeded);
  - the stored bytes count against the real recorder's limit before anything is fetched;
  - the start line names the run and stored bytes;
  - arguments that are not whole numbers are refused, including an empty or missing size;
  - the watched list must be the frozen one.

## Files

- `scripts/measure-pc.sh`, `scripts/measure-pc.mjs`, `logs/measure-pc.log`: section 1.
- `scripts/simulate.sh`, `scripts/gh-stand-in.sh`, `logs/simulate-16cc675.log`, `logs/simulate-eb09004-stopped.log`: section 5.
- `scripts/seed-data-branch.sh`, `logs/seed-host.log`: section 6.
- `scripts/mutations.sh`, `logs/mutations.log`: section 7.

## Sources (read 2026-10-29)

- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows: the shortest interval is "once every 5 minutes"; the `schedule` event "can be delayed during periods of high loads"; scheduled workflows "will only run on the default branch". In a public repository they "are automatically disabled when no repository activity has occurred in 60 days". Events made with `GITHUB_TOKEN`, apart from `workflow_dispatch` and `repository_dispatch`, "do not create workflow runs at all".
- https://docs.github.com/en/actions/reference/limits
- https://docs.github.com/en/rest/git/trees: the recursive listing's limit of 100,000 entries and 7 MB.
- https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits: 10 GB recommended on disk; 100 MB per file enforced; 3,000 entries per directory recommended; 2 GB per push enforced.
- https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features
- https://docs.docker.com/docker-hub/usage/pulls/, https://github.com/orgs/community/discussions/130794
