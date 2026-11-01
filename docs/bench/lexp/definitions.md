# LEXP: the end of exposure time, and found_at from the first run that saw the fix — definitions (2026-11-01)

Committed before the tests, the code or any run, so that no definition is loosened after a result is seen (git history shows the order). These are definitions of what the scheduled workflow records and how it is tested; nothing here changes a gate, the wait table or a rule of CLAUDE.md. Starting point: main 10e5963892f63733489eca97f4eeb4dcc88deb3b.

What it builds (docs/status.md, "Missing before complete", item 2: "the exposure-time end (the merge is not recorded), found_at from the first run that saw the fix rather than the run's lookup"):

1. the merge of a PR Ludion opened is recorded, on that PR, with GitHub's merge time: the end of that fix's exposure time;
2. the PR's "Found" time is the time of the first run, of an unbroken row of this workflow's runs, whose check saw the fix, instead of this run's lookup.

Neither needs a state ref (LB2b-next(2)'s), a new secret, a server or a store of Ludion's: both are read from and written to GitHub, in the user's repository.

## 1. Exposure time, and which time is its end

- Exposure time of a fix = its end − `fix_published_at` (CLAUDE.md, Product: "the time from a published fix to it being in the project's configuration").
- **The end** = `merged_at` that GitHub gives for the PR Ludion opened for that fix, when that PR is merged into the repository's default branch. At that time the fix is in the project's configuration on its default branch. It is not a deployment: when production gets the fix is not recorded, and the record says so.
- A fix with no `fix_published_at` (none, or not read, as the PR body says) has no exposure time; its merge is still recorded. An image move with no newer security release is not counted in exposure time (docs/decisions/2026-10-31-limgv-image-newest-built-release.md), and its record says so.
- **Not an end, so not recorded:** a PR closed without merging; a merge into another branch; the fix reaching the default branch by any other way (applied by hand, by another tool's PR, a cherry-pick); a merge whose `pull_request` event starts no workflow run (for example a merge made with a workflow's own token, for which GitHub starts no workflow). These fixes have no recorded end.

## 2. Where and how the merge is recorded (the template's fourth job)

- The template (action/patch-workflow.yml) also runs on `pull_request` of type `closed`. A fourth job, `merged` (action.yml `mode: merged`), runs only when that PR was merged and its head branch starts with `ludion/`; the three scheduled jobs do not run on that event.
- The job has `pull-requests: write` only (no contents, no secret), checks out nothing and runs only the bundled CLI: `ludion deliver merged`.
- It reads the PR through the API and records only when all of these hold: merged is true; `merged_at` is a time and `merge_commit_sha` a full SHA; the PR's author is `github-actions[bot]`; its head is in this repository and its head ref matches Ludion's branch names; its base ref is the default branch; its body starts with Ludion's marker line `<!-- ludion-fix -->`. Otherwise it records nothing and says why (exit 0). A failing API call fails the job.
- **The record** is one comment on that PR, by the job's token, whose first line is a marker `<!-- ludion-merged {…} -->` holding the record as JSON (schema 1: the PR number, head ref, `merged_at`, `merge_commit_sha`, and `fix_published_at`, `found_at`, `applied_at` as the PR body gives them, or null), then a table for people: the times, the hours from published to merged (exposure time), from published to found, and from found to merged.
- The three earlier times come from the PR body that Ludion's PR job wrote. The body can be edited by anyone who can edit the PR, so the record says that they are the body's, checked for form only (as the body already says of the receipt's). `merged_at` and the merge commit are GitHub's.
- **Once per PR:** when the PR already has a comment by `github-actions[bot]` starting with `<!-- ludion-merged`, nothing is posted again (a re-run of the job). At most 1,000 comments are read for this; with more, it posts.
- A negative duration (a body time later than `merged_at`) is shown as not computed, with the reason.

## 3. found_at: the first run that saw the fix

- **What a run saw** is recorded by its check job (it runs no dependency code and holds `contents: read` and `pull-requests: read`): whenever `ludion check` decides, it writes `seen.json` and the job uploads it as the artifact `ludion-seen` (retention 90 days, or the repository's limit when that is shorter). The record: schema 1, `checked_at` (the check's own time), the run's commit, the policy's ecosystem, and per key (definitions of LB2b-next(1), item 3) the advisory IDs of its findings (npm, Composer), or, for an image, the newer security releases the scan lists and the candidate version. An undecided check writes no record. The check's answer (`work`) does not read any record; this changes nothing in how it decides.
- **The fix's identity** across runs: npm and Composer: the same ecosystem and package, and at least one advisory ID the fix's changes name; an image move with a newer security release: at least one of the security releases the fix's receipt lists; an image move with none: the same candidate version.
- **The walk** (the PR job, `ludion deliver open`, only for a fix it is about to open, once per run): from this run back, newest first, through this workflow's runs on the default branch started by `schedule` or `workflow_dispatch`, at most 100 runs:
  - a run whose record is readable and valid (below) and lists the fix: the fix was seen then; go on to the run before it;
  - a run whose record is readable and valid and does not list it: the row ends; stop;
  - a run with no record (the check did not decide or failed, the artifact expired or was not uploaded, it cannot be read or is not valid): passed over; it neither lists the fix nor ends the row.
- **found_at** = the earliest `checked_at` among the runs of that row that list the fix, or the receipt's `found_at` (this run's lookup) when that is earlier or when no record lists the fix.
- **A record is valid** when it is at most 1 MiB, a zip whose `seen.json` entry is stored or deflated, at most 1 MiB once inflated, JSON of the shape above, every value matching the PR job's strict patterns (advisory IDs as `ADVISORY`, versions as `VERSION`, keys as `ludion check` writes them), the ecosystem is the policy's at this run's base, and its `checked_at` lies between GitHub's `run_started_at` of its run and GitHub's `created_at` of its artifact.
- The artifact's download is GitHub's API (`actions: read`, which the PR job gets in the template), then the address GitHub redirects to, fetched over https without the token.
- **Without state** (the definitions of LB2b-next(1), item 1: no state ref yet): this walk is the stand-in for one. When it cannot be done — the PR job's token cannot read the runs (no `actions: read`), GitHub's API fails, or this run's own run cannot be read — found_at is the receipt's (this run's lookup), the PR body says that and why, and the fix is opened as before. The walk never stops a fix.
- **What the PR body says** in its "Found" row: the time; which run's check saw it first; how many records were read; and, when the walk stopped at the limit or at the oldest run GitHub listed while the row had not ended, that an earlier run may have seen it first. The receipt keeps its own `found_at` (that run's lookup), unchanged.
- **What found_at can be wrong about, stated:** a record is data written by the run's check job, but the same run's patch job, which runs candidate code, holds the run's artifact token, so a candidate that escaped the sandbox could replace or delete its own run's record; the bound on `checked_at` keeps a forged time inside that run's span, so the effect is at most a found_at moved to another run of the row, or a row ended or passed over early. A run GitHub did not start saw nothing. found_at is a measurement: it decides nothing (no wait, no gate, no PR).

## 4. Tests (written first; each must fail on 10e5963)

In packages/cli/test, run in Docker (node:24 pinned by digest, a copy in the volume ludion-lexp-w, `npm ci --ignore-scripts` with the network, everything after it with `--network none`, no Docker socket, `--memory 4g`, the worktree mounted read-only). GitHub's API and the artifact download are stand-ins; no test reaches the network.

- X1: `deliver merged` on a merged Ludion PR posts one comment whose first line is the marker with the JSON record (merged_at, merge commit, the body's three times) and whose table gives the exposure hours; a second call posts nothing.
- X2: it records nothing for a PR that is not merged, not by `github-actions[bot]`, from another repository, from a branch that is not Ludion's, into another branch, or without the marker; a failing API call throws; an image move with no newer security release is recorded with "not counted"; a body time later than merged_at is not computed.
- X3: `ludion check --seen <file>` writes the record of section 3 when it decides (advisories per dependency key; releases and candidate for an image) and writes nothing when it does not.
- X4: the walk: found_at is the earliest run of the row that lists the fix; a run whose valid record does not list it ends the row; a run with no record, an expired one, an invalid one (wrong ecosystem, a time outside its run, a bad advisory, not a zip, too large) is passed over; another advisory of the same package does not match; the limit of 100 runs is kept and the body says an earlier run may have seen it; runs of another event or branch, or later than this run, are not read; the download goes to the redirect without the token.
- X5: when the runs cannot be read (403, an error), found_at is the receipt's, the body says why, and the PR is still opened; the walk is not done for a fix whose PR exists.
- X6: the template and action.yml: on `pull_request` `closed` too; the `merged` job has `pull-requests: write` only, runs only for a merged PR from a `ludion/` branch, and checks out nothing; check, patch and the PR job do not run on that event; the PR job has `actions: read` added and nothing else; the check job uploads `ludion-seen` and still downloads no artifact; the concurrency group keeps a merge's run out of the scheduled runs' group; every action is pinned by a full SHA; start.sh accepts mode merged on `pull_request` only and refuses it elsewhere.

## Not done here

- No run in a GitHub repository (the action has no release commit with its bundle; the template keeps a placeholder SHA). Whether GitHub starts the `pull_request` `closed` run for a PR opened with a workflow's token, when a person merges it, is not tested on GitHub here.
- The median exposure time and human minutes per fix are not computed: the records they need now exist on each merged PR; a reader that collects them is a later lane.
- The state ref, notification, the ignore list, the hourly cron and the push trigger (LB2b-next(2) and (3)).
