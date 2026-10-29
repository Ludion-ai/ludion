# Ludion — a judge for npm dependency updates

Ludion reads a dependency-update PR (from Dependabot, Renovate or a person) and says, in one comment on the PR, whether the update may be taken, when, and why not. It checks parts of gates 1, 2 and 4 and the wait of docs/design.md: provenance, publisher, install scripts, malicious-package records, deprecation, new dependencies, versions that move with the fix, and the lockfile's tarballs and hashes. Every changed version counts as production. It does not build or test anything (gate 3), so it never says a PR can be applied; it changes no file, merges nothing, and lists what it did not check. What is built and what is not is in [docs/status.md](docs/status.md).

Ludion does not find vulnerabilities or write updates: Dependabot or Renovate open the PRs, and the judge stands behind them. It reads npm only.

## Getting started: judge your npm dependency PRs

**プレビュー：コメントのみ。マージは行わない。** Preview: comments only; nothing is merged.

The judge reads a dependency PR's package.json and package-lock.json (from Dependabot, Renovate or a person) and comments on the PR with what it found. It checks parts of gates 1, 2 and 4 and the wait (docs/design.md). It does not build or test anything (gate 3), so it never says a PR can be applied, and its output lists what it did not check. It is not a required check unless you make it one.

**Not released yet.** No release commit exists yet. The action needs a release commit, because only that carries the bundled judge; at any other commit it stops with an error. When one is published, pin its full 40-character SHA (not a tag or branch) in both workflows.

Add two workflows. The first judges with read access only and runs nothing from the PR:

```yaml
# .github/workflows/ludion-judge.yml
name: ludion-judge
on:
  pull_request:
    paths: [package-lock.json]
permissions:
  contents: read
# A newer push cancels the judgement of an older head.
concurrency:
  group: ludion-judge-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  judge:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: Ludion-ai/ludion@<release commit SHA>
        with:
          mode: judge
```

The second posts the result. It runs from your default branch after each judge run, checks the result as untrusted data, and keeps one comment per PR up to date:

```yaml
# .github/workflows/ludion-judge-comment.yml
name: ludion-judge-comment
on:
  workflow_run:
    workflows: [ludion-judge]
    types: [completed]
permissions:
  actions: read
  contents: read
  pull-requests: write
# One comment run at a time per PR branch, so two runs cannot both post a comment.
concurrency:
  group: ludion-judge-comment-${{ github.event.workflow_run.head_repository.full_name }}-${{ github.event.workflow_run.head_branch }}
  cancel-in-progress: false
jobs:
  comment:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: Ludion-ai/ludion@<the same release commit SHA>
        with:
          mode: comment
```

A change to that SHA (from Dependabot, for example) is an update to Ludion itself: review it like any dependency update, and do not auto-merge it.

Limits: GitHub-hosted Linux runners (the action needs gh, jq, unzip, GNU date and Node 22 or later); only the root package.json and package-lock.json, and each changed */package.json, are read (the judge leaves a workspace package.json out of gate 4's changed-files stop when it agrees with the lockfile; one that does not agree stops, and one that cannot be read on both sides, such as an added, removed or renamed workspace's, is undecidable); a PR that changes .github/ or 300 or more files is shown as undecidable; the comment job posts only for PRs into the default branch. It sends package names and versions to OSV and the npm registry, the IDs of the advisories OSV returns back to OSV, and their CVE IDs to FIRST's EPSS service; it downloads CISA's catalog of exploited vulnerabilities whole. No source is sent.

## Run the judge locally

The published npm ludion-ai 0.1.4 release is the earlier lesson product, which ended on 2026-10-28; no release of the judge is on npm yet. Build this repository (Node 24) and give the judge two checkouts of your project, before and after the update, and the files the update changes:

```sh
npm ci
npm run build -w ludion-ai
node packages/cli/dist/cli.js judge --before /path/to/app-main --after /path/to/app-pr --files package.json,package-lock.json
```

Exit codes: 0 ready except build (gates 1, 2 and 4 found nothing and the wait is over); 3 wait; 1 stop or undecidable, also when a lookup fails or `--files` is missing; 2 the inputs could not be read. `--json` gives the whole judgement. A pnpm-lock.yaml is read as the set of versions it adds, which is always undecidable. It sends package names and versions to OSV and the npm registry, the IDs of the advisories OSV returns back to OSV, and their CVE IDs to FIRST's EPSS service; it downloads CISA's catalog of exploited vulnerabilities whole. No source is sent, and no dependency code is run.

## What was removed on 2026-10-29

The commands that scanned and patched PHP Docker, npm, Composer and Maven projects (`init`, `scan`, `patch`, `watch`), the read-only Python, Go and Rust scans, their Docker sandbox and the example projects were removed when Ludion was cut to the judge (docs/decisions/2026-10-29-judge-only.md). None of them was ever released on npm. Their code stays in this repository's history at commit 5553d671387676e9e09d4783b32d9e7d658b4ffc.

## The earlier lesson product

The lesson commands (`sync`, `teach`), the lesson data and the MCP server of ludion-ai 0.1.x ended on 2026-10-28; their code and data are kept in the git tag `archive/lessons-2026-10-27`.
