# L9 (night v2): the workspace package.json rule wired into the judge, and #161 and #162 judged again

Continues docs/bench/2026-10-28-l9-workspace-stop, which stopped before the wiring because L1 (#168) was changing judge.ts and judge-cli.ts. #168 merged (e72301d), and main was merged into the branch first.

Definitions: docs/decisions/2026-10-29-l9-workspace-package-json.md, fixed before any re-judgement (05b6b7d). How the wiring reads them: docs/decisions/2026-10-29-l9-workspace-wiring.md.

## What changed

- `packages/cli/src/security/judge-cli.ts`: `workspaceManifests` reads each changed `<dir>/package.json` on both sides and calls `workspaceManifestChanges`. `judgeCli` passes the result to `judge()`.
- `packages/cli/src/security/judge.ts`: `judge()` takes `workspaces`. An agreeing file leaves the changed-files stop, and one info line names it. Otherwise each reason stops. A side that could not be read is undecidable.
- `packages/cli/src/security/workspace-manifests.ts`, after the review (#174, comment 6473296446, at 90401ed, which approved with no blocking finding). Both changes only tighten the rule:
  - rule 2 reads only the lockfile's own entries, so a folder named `__proto__` is not recorded by `Object.prototype`;
  - a `*` in `workspaces` does not match a segment that starts with a dot.
- `packages/cli/test/workspace-manifests.test.ts`: 11 more tests, 19 in all (cases for the two review fixes were added to the rule 1 and rule 2 tests; temporary folders are removed after the tests):
  - #161's and #162's shapes on disk, judged with and without the rule: the agreeing file is no stop, and the findings are otherwise equal;
  - an agreeing file next to another changed file still stops on the other one;
  - five disagreeing cases stop (a range the lockfile does not record, a new install script, a spec outside the registry, a file that is not JSON, a folder the root's `workspaces` do not name);
  - undecidable when either side or both are missing, or a side is a symlink;
  - no file outside a plain workspace folder is read;
  - through `judgeCli` itself, offline (every lookup fails).
- Not changed (protected, LP-rest #185): `.github/workflows/judge.yml` and `action/read.sh`. They must copy each changed `*/package.json` on each side whose commit has it; #185 does this.

## Results

All in Docker. Scripts are in `scripts/`; the outputs are in `raw/`.

- **Tests** (`raw/tests.txt`, `scripts/run.sh`, node:24-slim, `--network none`, `--read-only`, non-root, at b8215bd):
  - `npm run typecheck`: exit 0.
  - `vitest run --project node`: Test Files 1 failed | 14 passed (15); Tests 349 passed | 13 skipped (362). The failed file is `apps/site/test/knowledge.test.ts`, `spawnSync git ENOENT`: the image has no git. `npm run build` failed the same way (astro, `spawnSync git ENOENT`).
  - Both were run again in the same image with git added and a throwaway repository of the same files (`raw/site.txt`, `scripts/site.sh`, at b8215bd): knowledge.test.ts 5 passed, build exit 0.
- **Mutations** (`raw/tests.txt`). Each mutant must make a test in workspace-manifests.test.ts fail.
  - The module's 14 (2026-10-28 `mutate.mjs`): survived 0 of 14.
  - The wiring's 17 (`scripts/mutate-wiring.mjs`: 8 in judge.ts, 6 in judge-cli.ts, 3 undoing the review fixes): survived 0 of 17. At 6207c43, before the last test was added, the mutant that undoes the own-entry check on the before side survived (1 of 16); the test of a `__proto__` record on one side only (b8215bd) kills it.
- **Re-judgement of #161 and #162** (`raw/inputs.txt`, `raw/judgements/`, `raw/compare.txt`; `scripts/extract.sh`, `judge.sh`, `compare.mjs`).
  - **Inputs.** As judge.yml takes them, with each changed `<dir>/package.json` added on both sides. #161: merge 470a554, base be86239, head b5014dd. #162: merge 6758c40, base be86239, head eedb106. These are the heads the PRs had; Dependabot was not asked to rebase (the comment was not posted, below).
  - **Judges.** Fixed: this branch at 4cfc189, dist/cli.js sha256 6015c723…0872. Unfixed: main at 3b6ed1c, sha256 bccbfd45…1d70. Both ran in node:24-slim, `--read-only`, non-root, with network for the registry and OSV. Same inputs, `--now 2026-10-28T15:27:03Z`.
  - **Again after the review fixes** (`raw/judgements-b8215bd/`, `raw/compare-b8215bd.txt`). Fixed at b8215bd (sha256 3eb9b8b9…46a5) and main at 3b6ed1c, same inputs and `--now`. All four judgements are byte for byte the same as the 4cfc189 run's. The table below holds for both.

| PR | Unfixed verdict | Fixed verdict | False stops, unfixed → fixed | Other differences |
| --- | --- | --- | --- | --- |
| #161 (hono 4.13.13 → 4.13.14, apps/worker) | stop | ready_except_build | 1 → 0 (apps/worker/package.json) | none |
| #162 (astro 7.3.6 → 7.4.2, apps/site) | stop | stop | 1 → 0 (apps/site/package.json) | none |

  - **#161, fixed.** Two findings: gate 1 info (production/dev split without `--source`), and gate 4 info ("apps/worker/package.json: a workspace's dependency lists change, and before and after they equal the lockfile's record of that workspace."). Urgency normal, wait 72h, wait until 2026-10-28T07:19:30.732Z. `ready_except_build` means gates 1, 2 and 4 found nothing and the wait is over; gate 3 (build/test) is not run by the judge, so this is not "apply".
  - **#162, fixed.** It still stops on gate 2, as before. unist-util-visit-parents@6.1.0 and unist-util-visit@5.2.0 were published at or after the fix (T = 2026-10-21T14:18:56.764Z). Four gate 2 extend findings: astro@7.4.2 adds tinyps; fnv1a-64 and tinyps are new; unifont@1.0.3 adds fnv1a-64 and std-env. Wait 144h, until 2026-10-30T18:44:36.789Z.
  - **Compared** (`raw/compare.txt`): in each PR the only findings that differ are the changed-files stop (unfixed only) and the info line (fixed only); every other field of the judgement is equal.

## Not done

- **`@dependabot rebase` on #161 and #162.** Not posted: the session's permission check refused the `gh pr comment` call. So the PRs were judged at their existing heads.
- **This judge in CI.** judge.yml on main still copies only the root files. Until #185 lands, its run of this judge finds the workspace file unreadable, and the verdict is `undecidable` instead of `stop`.
