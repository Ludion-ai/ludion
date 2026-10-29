## 2026-10-28 (cycle 2) — The judge on this repository

The owner chose C1: the judge v0 runs on this repository's own dependency PRs, comments only, so it gets real data. Two workflows, split as the design's "Actions の権限分離" splits jobs:

- **`judge.yml`** (`pull_request` when the root `package-lock.json` changes; `contents: read`, no secrets).
  - The judge is built from the base commit (`npm ci --ignore-scripts`, then the CLI's own build), never from the PR, because a PR here can change the judge itself.
  - The PR is data. Its `package.json` and `package-lock.json` are copied out of its test merge commit with `git show`, and the changed files come from `git diff` between the base and that commit. Nothing from the PR is installed or run. The base commit is the test merge commit's first parent, and the second must be the event's head. The event's own base SHA is not used: GitHub sets it when the PR opens and does not update it when the base branch moves. The base commit must be in the last 50 commits of the base branch. Otherwise the record says undecidable.
  - The record (`.github/judge/record.ts`, uploaded as the `judgement` artifact) holds the PR number, the head SHA judged, the base and merge SHAs, the verdict, the judge's JSON and its rendered text, and how long it took (the judge alone, and since the job started).
  - It says undecidable from the first step on. Only a judge that exited with the code of a parseable judgement replaces it, with that judgement. A failed build, read or judge stays undecidable, never a pass.
  - The job fails when the judge gave no judgement, so its colour shows the judge's health, not the verdict.
- **`judge-comment.yml`** (`workflow_run` of `judge`; `pull-requests: write`, `actions: read` and `contents: read`).
  - It runs from the default branch and checks out nothing. It runs nothing from the PR or the repository, only `gh`, `jq`, `unzip`, `head` and `mkdir`. It comments only on PRs into the default branch, since a PR into another branch is judged by that branch's judge.yml.
  - The artifact is untrusted data. It must match the record's schema exactly: keys, types, lengths, and a verdict that agrees with the judge's own.
  - It comments only when the recorded head is both the run's head and the PR's current head, and the PR's head repository and branch are the run's; otherwise nothing.
  - One comment per PR, found by a marker and the `github-actions[bot]` author, updated by each new judgement. It starts with 「プレビュー：コメントのみ。この判定でマージは行われない。」 and says that v0 judges parts of gates 1, 2 and 4 and the wait, not gate 3. "Ready except build" is shown as 可, with the note that gate 3 was not run, so it is not a judgement that the update may be applied.
  - The judge's text is an indented code block, cut so that the comment stays under GitHub's limit once indented. Some characters are dropped: control characters (C0 and C1), the soft hyphen, bidirectional marks, overrides and isolates, zero-width and invisible format characters, line and paragraph separators, and tag characters. Nothing in it becomes Markdown, a mention or a line of its own, so no `reviewed-sha:` line can come from it.

Chosen here:

- **`actions: read` and `contents: read` besides `pull-requests: write`.** The task names `pull-requests: write` only. Reading another run's artifact needs `actions: read`, and reading what a commit changes (the compare API, below) needs `contents: read`. Both are read-only.
- **A head that changes `.github/` gets a fixed "undecidable".** A `pull_request` run takes its workflow file from the PR, so such a PR could rewrite `judge.yml` and upload any record. judge-comment.yml then posts a fixed notice instead of the record's text. What the head changes is read from the compare API between the PR's base branch and the run's own head SHA, not from the PR's file list: a push while the job runs cannot change it. When the answer lists 300 files, where GitHub stops listing them, the result is refused too. The run must also be `judge.yml`'s by path, not only by workflow name.
- **A finished run with no record is an error**, not "nothing to post"; only a cancelled run may leave none. A re-run replaces the record (`overwrite`), and the newest record is read.
- **A changed file whose name has a comma or surrounding spaces makes the record undecidable.** The judge takes the changed files as one comma-separated list.
- **The trigger is the root `package-lock.json` only.** The judge reads one project root. `examples/npm-security/package-lock.json` is a fixture and is not judged.
- **Every action is pinned by commit SHA**: checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2. The comment job uses none. The existing workflows keep their tags; they are not changed here.
- **Not a required check.** Nothing here changes branch protection.
- **actionlint** 1.7.12 (with shellcheck) was run in Docker by hand. CI does not run it.

Known limits:

- A Dependabot update of a workspace's dependency (packages/cli, apps/site, ...) changes that workspace's `package.json`. The judge v0 allows only the root `package.json` and the lockfile, so gate 4 stops it. The judge is not changed here; the dogfood records will show how often that happens.
- `workflow_run` runs only from the default branch, so judge-comment.yml cannot run before this is merged.
- That a Dependabot PR's `workflow_run` gets a write token comes from GitHub's docs, which recommend this two-workflow split for Dependabot PRs. It has not been seen on this repository yet.
- A "wait" is judged again only when the PR changes or the job is re-run. Nothing schedules the re-query when the wait ends.

The weekly measurement (docs/bench/dogfood/) starts after this is merged.

The first review (fresh context) asked for changes (https://github.com/Ludion-ai/ludion/pull/156#issuecomment-6464857274). Its blocking findings:

- the `.github/` refusal read the PR's current file list, so a push during the job could hide a forged head's change;
- no test pinned the refusal.

Both are fixed as described above, and tests now break when the refusal is removed, its pattern changes or its limit is raised.

Its non-blocking findings are fixed too:

- the comment's length once indented;
- a missing record;
- a re-run's record;
- file names with commas;
- a newline after a SHA or a time;
- the head repository and branch;
- the wording of 可 and of the gates covered;
- the characters dropped.

That review's comment ends with a `reviewed-sha:` line for 141d38e although it asks for changes. That head is no longer the PR's, so the line no longer counts.

The second review (fresh context, https://github.com/Ludion-ai/ludion/pull/156#issuecomment-6465351754) found both round-1 fixes sound, and asked for changes again. Its blocking finding: the read step required the test merge commit's first parent to equal the event's base SHA. That SHA goes stale once the base branch moves, so after the first push nearly every judgement would have been undecidable. On #156 itself, the stored base was 3e2e350 while GitHub merged 44c0fb6 into 3418d55.

The base now comes from the merge commit, as above, and tests pin it. A throwaway draft PR into this branch (#159) checks it on GitHub (progress).

From that review's non-blocking findings:

- a SHA must be exactly 40 hex digits;
- the 300-file refusal says so;
- PRs into other branches get no comment;
- more invisible characters are dropped;
- `mkdir` is named.

Known and kept: when a later head no longer changes `package-lock.json`, judge.yml does not run, and the earlier comment stays. That comment names the head it judged.

