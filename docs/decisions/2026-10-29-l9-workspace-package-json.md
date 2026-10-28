# 2026-10-28 (cycle 3, L9) — Workspace package.json changes in the judge's gate 4

Moved here unchanged from docs/decisions.md, under the one-record-per-file rule (2026-10-29). The definitions were first committed in 05b6b7d (2026-10-28 21:53:03 JST), before any re-judgement; the second section in efbc772 (2026-10-28 22:00:29 JST). Neither is changed here.

## 2026-10-28 (cycle 3, L9) — Workspace package.json changes in the judge's gate 4: definitions, fixed before any re-judgement

A Dependabot update of a workspace's dependency changes that workspace's `package.json`, and gate 4 stops it ("The change also touches apps/worker/package.json", #161; apps/site, #162). These definitions are committed before any re-judgement. The gate criteria and the wait table are not changed.

**The rule.** A changed file other than the root `package.json` and the lockfile still stops gate 4, except `<dir>/package.json` when it agrees with the lockfile. It agrees when all five hold:
1. `<dir>` is a plain relative folder (segments of letters, digits and `@._-`, no `.` or `..`, no `node_modules`). A `workspaces` entry of the root `package.json` matches it, before and after. Only literal segments and a `*` that is a whole segment are matched. Any other pattern (`**`, `?`, `[`, `{`, `!`, a `*` inside a segment) matches nothing.
2. Both lockfiles record that workspace: `packages["<dir>"]` exists before and after.
3. The `package.json` exists on both sides and is a JSON object. Only its dependency lists (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`) differ, and every changed spec is a registry range or an `npm:` alias of one, as for the root. `overrides` in a workspace stops: npm reads overrides only at the root, so the lockfile cannot show them.
4. Before and after, each of the four lists equals the same list in the lockfile's record of that workspace. A missing list counts as empty.
5. In the lockfile's record of that workspace, only the four lists change.

The rest is judged as before: the lockfile diff, gate 2, the wait, and gate 4's tarball, hash and link checks. A workspace `package.json` that cannot be read (the caller did not pass it) is undecidable, not agreeing.

**What is counted.**
- **A false stop (誤停止):** a file named by gate 4's changed-files stop that is a workspace `package.json` agreeing with the lockfile (1–5). It is counted per file.
- **A correct stop:** a file named by that stop that is not a workspace `package.json`, or one that fails any of 1–5.
- **Not counted either way:** stops for other reasons. This measures gate 4's changed-files stop, not whether a verdict is right.
- **No correct stop may disappear.** With the same inputs and `--now`, the fixed judge's findings must equal the unfixed judge's, except two: each agreeing workspace file is gone from the changed-files stop (the stop is gone when no file is left), and an info line names the agreeing files. Any other difference is reported as it is. Each run fetches registry facts, so a difference in them is reported, not explained away.

**The tests (task step 3).** Fixtures shaped like #161 (one workspace range, one locked version changes) and #162 (one workspace range, many locked versions change):
- when the workspace file agrees, there is no gate 4 changed-files stop;
- when it does not, there is one: each of 1–5 is broken in turn.

**The re-judgement (task step 4).**
- **Inputs.** #161 and #162, at the head SHAs they have when it runs, which are recorded. Inputs are taken as judge.yml takes them: `before` from the first parent of `refs/pull/N/merge`, `after` from that merge commit, `--files` from `git diff --no-renames --name-only` between them. Each changed `<dir>/package.json` is added on both sides.
- **Judges.** The fixed judge and the unfixed judge (main at that time), run in Docker with the same inputs and `--now`.
- **Reported.** Both verdicts and every finding, copied, and the number of false stops before and after. Nothing is merged.

## 2026-10-28 (cycle 3, L9) — Workspace package.json changes: where it stopped, and the owner's decisions on the release

- **Stopped for the coordinator.** `workspaceManifestChanges` (packages/cli/src/security/workspace-manifests.ts) implements rules 1–5 above. Its tests cover the #161 and #162 shapes and each rule broken in turn. `ludion judge` does not call it yet.
  - The call belongs in judge.ts and judge-cli.ts, which L1 (#168) changes, so L9 did not change them.
  - judge.yml (protected) and action/read.sh copy only the root manifest and lockfile; they would also have to copy the changed workspace manifests.
  - #161 and #162 were not judged again. Details: docs/bench/2026-10-28-l9-workspace-stop/.
- **The owner's decisions (2026-10-28 21:44 JST, recorded here only; built later):**
  - ludion-ai 0.1.x is deprecated when the new version is published, not before.
  - The release commit comes after the gate passes. Another session reproduces the bundles' sha256 and checks them.
  - The judge always gives an update of Ludion's own action to a person to judge.
  - The Marketplace listing comes after the gate passes and the demo succeeds.
  - Mode comment is checked on a test repository that the owner creates, Ludion-ai/ludion-sandbox.
  - Four more decisions, each built in a separate protected-path PR, not in L9:
    - publish with dist-tag `latest`;
    - put LICENSE in the tarball;
    - make action.yml and action/ protected paths before publishing;
    - set the engines lower bound to Node 22.
