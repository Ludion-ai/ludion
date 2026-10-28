# L9: the judge's gate 4 stop on workspace package.json changes

Task: a Dependabot update of a workspace's dependency (apps/worker, apps/site, ...) changes that workspace's `package.json`. The judge v0 allows only the root `package.json` and the lockfile, so gate 4 stops it (#161, #162; docs/decisions.md, "Known limits" of the judge on this repository). Such a change should not be a gate 4 stop reason when it agrees with the lockfile change; a change that does not agree still stops.

**State: stopped for the coordinator.** The rule is built and tested as a module, but `ludion judge` does not call it. The call belongs in two files that L1 (#168) also changes, and L9 leaves those to the coordinator (below). So #161 and #162 have **not** been judged again (task step 4), and the judge's verdicts on them are unchanged.

## Files declared before starting (2026-10-28T12:51:17Z, commit d20e34c)

L1's files are in `l1-files.txt` (`git fetch origin`, then `git diff --name-only origin/main...origin/lane/l1-applicability`; L1 is #168, at 1a532c0).

L9 changes:

- `docs/bench/2026-10-28-l9-workspace-stop/` (this folder);
- `docs/decisions.md` and `docs/progress.md`, appended at the end only (every lane appends there; L1 also changes decisions.md);
- `packages/cli/src/security/workspace-manifests.ts` (new): whether a workspace's `package.json` change agrees with the lockfile;
- `packages/cli/test/workspace-manifests.test.ts` (new): its tests.

## What the fix still needs, not changed by L9

| File | Why it is needed | Why L9 did not change it |
| --- | --- | --- |
| `packages/cli/src/security/judge.ts` | Gate 4's changed-files stop is made in `judge()` (lines 376–385 at 75622bd). It has to drop agreeing workspace files from that stop, stop on the others' reasons, and add an info line. | L1 changes it, in the lines just after (the `extraneous` stop) and in `judge()`'s input type. |
| `packages/cli/src/security/judge-cli.ts` | It reads the manifests and lockfiles and calls `judge()`. It would also read each changed `<dir>/package.json` on both sides and call `workspaceManifestChanges`. | L1 rewrites the same lines (the production/dev split). |
| `.github/workflows/judge.yml` | It copies only the root `package.json` and `package-lock.json` into the judge's `before`/`after` (lines 82–85). A fixed judge would find no workspace `package.json` there, which makes the change undecidable under the definitions. | Protected path (docs/protected-paths.md). |
| `action/read.sh` | The same for the action (lines 22–25). | Not in L9's area; the owner has decided that `action.yml` and `action/` become protected paths before the action is published. |

The wiring, as planned (not written to those files):

- **judge-cli.ts.** For each listed file `f` other than `package.json` that ends in `/package.json`, read it from `before` and `after`; a side without it gives `undefined`. Call `workspaceManifestChanges({ file: f, before, after, root: { before, after } (the root manifests), lock: { before, after } (the lockfiles' packages) })`, and pass each file with its reasons to `judge()`.
- **judge.ts.** Leave the files with no reasons out of `unexpected`. Stop on each reason. When a side is missing, the result is undecidable too. Add one info line that names the agreeing files.
- **Tests.** Judge-level tests in `judge.test.ts` with the same two shapes: no gate 4 stop when the file agrees, a stop when it does not.
- **judge.yml and action/read.sh.** Copy each changed `*/package.json` from the list on both sides, when that commit has it.
- **pnpm.** Not covered: pnpm workspaces are named in `pnpm-workspace.yaml`, so a pnpm change keeps today's stop.

## The rule (docs/decisions.md, "Workspace package.json changes in the judge's gate 4", committed in 05b6b7d before anything was run)

`workspaceManifestChanges` returns no reason only when all five rules hold:

1. the folder is a plain relative folder that the root's `workspaces` names before and after (literal segments and a whole-segment `*` only);
2. both lockfiles record the workspace;
3. the file exists on both sides as an object, and only registry specs in the four dependency lists change (no `overrides`);
4. the four lists equal the lockfile's record before and after;
5. the lockfile's record changes only in those lists.

## Results

All runs in Docker: node:24-slim (image 55fb5f5a527e, node v24.22.1), `--network none`, `--read-only`, non-root. The dependencies come from `npm ci --ignore-scripts` into a separate volume, run with network before the offline runs.

- **Tests** (`raw/tests.txt`, at ae59b19, `scripts/tests.sh`). `tsc -p tsconfig.json` exit 0. `vitest run --project node packages/cli/test`: Test Files 6 passed (6); Tests 187 passed, 5 skipped (192). `workspace-manifests.test.ts` has 8 tests:
  - the #161 shape (one workspace range, one locked version) and the #162 shape (one range, several locked versions, some added) agree;
  - list order and a missing list do not count;
  - an alias and other `workspaces` spellings are accepted;
  - rules 1 to 5 are each broken in turn and give a reason.
- **Mutations** (`raw/tests.txt`, `scripts/mutate.mjs`). 14 changes to the module, each removing or loosening one check. Each made at least one test fail: survived 0 of 14.
- **The module alone on #161's and #162's real files** (`raw/module-check.txt`, `scripts/module-check.ts`, `extract.sh`, `modcheck.sh`). Inputs as judge.yml takes them: before is be86239, the first parent of each merge ref; after is the head, b5014dd and eedb106, each equal to its merge ref. Output: `apps/worker/package.json` reasons `[]`, `apps/site/package.json` reasons `[]`. This is not a re-judgement: the judge was not run, and #162's other stops (gate 2) are not looked at here.
- **Re-judgement of #161 and #162 (task step 4).** Not done: the judge does not call the module (above).
