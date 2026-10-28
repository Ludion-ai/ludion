# Pre-publish checklist

Nothing here has been published. This is what must be true, and who does it, before the npm package or the action is released. Ticked items were checked on this branch; the evidence is named.

## npm: ludion-ai

- [x] The tarball is exactly README.md, dist/cli.js and package.json, with no dependencies and no install scripts (npm-pack.md; publish.yml checks the same before staging).
- [x] `files` names the bundle only (`dist/cli.js`), so nothing else a build writes into dist/ is published.
- [x] The README says, before anything else about the judge: **プレビュー：コメントのみ。マージは行わない。** It says the judge does not run gate 3, and that no release exists yet.
- [ ] Publish only through publish.yml (trusted publishing, staged, approved by the owner on npmjs.com). No token, no hand publish. **Owner.**
- [ ] Choose the dist-tag. `npm stage publish` with no `--tag` makes 0.3.0-preview.1 `latest`, replacing the lesson product's 0.1.4. Either is defensible; it is the owner's choice, and publish.yml would need `--tag` for anything but `latest` (a protected path). **Owner.**
- [ ] `npm deprecate` the 0.1.x versions (design.md, 掃除計画 step 7). **Owner, on npm.**
- [ ] LICENSE: package.json says Apache-2.0, but the tarball has no LICENSE file (none in packages/cli). Apache-2.0 asks that a copy of the license go with the work. Adding it changes publish.yml's expected file list, a protected path. **Decision for the owner; then a protected PR.**
- [ ] The README's "Getting started" becomes true only once a release commit exists (below): replace "Not released yet" with the SHA then.

## The action: action.yml

- [x] Mode judge runs with `contents: read` only, reads the PR's files as data through the API, and runs nothing from the PR. Mode comment runs in a separate workflow_run job with `pull-requests: write` and judge-comment.yml's checks (schema, head, `.github/` refusal, default branch, sanitised body). Local check: action-check/out/run-3.txt, 17 checks passed.
- [x] The bundles build the same twice: three builds in this session gave the same sha256 for packages/cli/dist/cli.js and action/dist/record.js (npm-pack.md).
- [x] The only action it uses (upload-artifact) is pinned by commit SHA, the one judge.yml uses.
- [x] Node 20, the floor start.sh accepts: mode judge on #161's files gave `stop` and a record that matches valid.jq (action-check/node20.sh, out/node20.txt, node:20.19.2-bookworm). Runs in GitHub used Node 24 (from the runner).
- [x] The README's workflows have the same concurrency as judge.yml (a newer push cancels) and judge-comment.yml (one comment run at a time per PR branch, so two runs cannot both post).
- [x] Live run of mode judge on GitHub, pinned by a full SHA: see "Live check" below.
- [ ] Live run of mode comment: not possible without a workflow on the default branch (workflow_run runs from there). It was checked locally only, with gh stubbed (run-3.txt). Before release, check it on a repository the owner approves, or by switching this repository's judge-comment.yml to the action (a protected PR).
- [ ] Release commit: from a commit on main, build in Docker (`npm ci --ignore-scripts`, `npm run build -w ludion-ai`, `node action/build.ts`), force-add packages/cli/dist/cli.js and action/dist/record.js, and commit them on a release branch (never main). Tag it. A second person rebuilds from the same main commit and compares both sha256 values before the SHA is announced. Today this is by hand; a workflow that does it would be a protected change.
- [ ] Announce the SHA with its tag. Users should check the SHA is the tag's commit in Ludion-ai/ludion, since GitHub also resolves `owner/repo@sha` for commits that exist only in a fork.
- [ ] Marketplace listing: not done, and needs the owner.
- [ ] Add action.yml and action/ to docs/protected-paths.md before the first release: users run this code with a `pull-requests: write` token. That is a protected PR.

## Live check

Throwaway draft PR #169 (closed, not merged; its branch test/action-l4-live was deleted afterwards, so that a working release-shaped commit is not left on a branch). 8bc8c59 is a release-shaped commit: 267f905 plus the two bundles, the same sha256 as above. Its second commit, 1c92aa0, adds a pull_request workflow with one step, `uses: Ludion-ai/ludion@8bc8c594f66289f7ccd2aa881c16b749447840fe` with `mode: judge`, and `permissions: contents: read`.

- Run 40683395492, job `judge`: success, 2026-10-28T11:53:13Z to 11:53:28Z. Steps: start 2156 ms, bundle 17 ms, read 4801 ms, judge 652 ms, then the summary and the upload, each success (`raw/live-169/judge-mode-40683395492.log`).
- The record: verdict `undecidable`, `judge_exit_code` 1, `judge_seconds` 0.461, `job_seconds` 5.472, base be86239, merge c898f37. The PR changes no lockfile, so the judge found no added version (`[info] gate 1: The lockfile change adds no package version.`). Real dependency PRs only reach the judge through the `paths: [package-lock.json]` filter.
- Artifact `ludion-judgement`: 1496 bytes. The record matches valid.jq (`raw/live-169/valid-check.txt`, jq 1.6 in Docker).

This shows the action resolves by SHA, the composite steps and their conditions run, the API reads work with a read-only token, and the artifact is uploaded. It does not show mode comment on GitHub (above), or a judgement of a real dependency change through the action. That second part was checked locally on #161's files (run-3.txt).
