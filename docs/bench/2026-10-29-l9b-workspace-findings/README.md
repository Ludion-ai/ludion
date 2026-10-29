# L9b: the two non-blocking findings on the workspace package.json rule, fixed

The owner decided on 2026-10-29 (09:30 JST, D) that these two findings get fixed. They are findings 2 and 3 of the review of #174 (comment 6473524412, at e2e8a73). The decisions were committed before the code (1cccdfb, docs/decisions/2026-10-29-l9b-workspace-findings.md). Both changes only add stops. The rule (docs/decisions/2026-10-29-l9-workspace-package-json.md), the wait table and every gate criterion are otherwise unchanged.

## What changed

- **A `!` entry in the root's `workspaces`** (`packages/cli/src/security/workspace-manifests.ts`, `excludes`).
  - Before: such an entry matched nothing, and it also excluded nothing, so with `["apps/*", "!apps/worker"]` the folder `apps/worker` was read as a workspace.
  - npm reads a leading `!` as an exclusion. This was checked in node:24-slim: npm 11.19.1, `@npmcli/map-workspaces` 5.0.3, `lib/index.js` (an odd number of `!` excludes, and a later entry can undo it). The source as read is in `raw/npm-workspaces.txt` (`scripts/npm-workspaces.sh`, offline, read only). It was added after the review of #193 (finding 4).
  - Now: when the root's `workspaces`, before or after, has any string entry containing `!`, no folder is read as a workspace. The reason names that entry, and the file stays in gate 4's changed-files stop. This check does not reproduce npm's exclusions, so it refuses to read them.
- **A top-level `"__proto__"`** (`packages/cli/src/security/judge.ts`, `own` and `manifestChanges`; rule 5 in `workspace-manifests.ts`).
  - Before: `JSON.parse` makes `"__proto__"` an own key, but `manifestChanges` read `b[key]`. On a side without that own key, this gave `Object.prototype`, which `JSON.stringify` writes as `{}`. So adding `"__proto__": {}` was not a change.
  - Now: both sides are read through their own keys only, and a key one side lacks is `undefined`. Adding, removing or changing it is a change to a field that is not a dependency list, which stops. This applies to the root `package.json` too, since it uses the same function. Rule 5 compares the lockfile's record of the workspace the same way. `old[name]` in the registry-spec check also reads own keys now, which is equivalent there (any value other than the spec is checked), so no mutant covers it.
- **Tests** (`packages/cli/test/workspace-manifests.test.ts`): 19 → 22.
  - Rule 1 with `!`:
    - seven `workspaces` shapes: an exclusion of the folder, an exclusion undone by a later entry (`["!apps/worker", "apps/worker"]`), an exclusion of another folder, `!!`, `./!`, `!` inside a segment, and `!` alone;
    - `!` on the before side only, and on the after side only;
    - through `workspaceManifests` (the judge's reader).
  - Rule 3 with `__proto__`:
    - in the workspace file: added, removed, and changed from `{}` to `{"scripts":{}}`;
    - the same own key on both sides changes nothing;
    - the root through `manifestChanges`, both directions;
    - no prototype is changed.
  - Rule 5 with `__proto__`: the record has it on the after side only, and on the before side only (stops); the same on both sides (no reason). The last case was added after the review of #193 (comment 6484899627, finding 3).
  - Through `judge()` on disk: a `__proto__` added to the file stops, and the file stays in the changed-files stop.
  - `["!apps/site"]` moved from rule 1's "matches nothing" list to the new `!` test, because its reason is now the exclusion.

## Results

All runs were in Docker, from scripts in `scripts/`. Outputs are in `raw/`. The setup:

- The `sync.sh` copy is in the volume `ludion-l9b-w`.
- Dependencies came from `npm ci --ignore-scripts` (`install.sh`), the only step with network.
- Everything else ran with `--network none`, `--read-only`, user `node`, 4 GB and 2 CPUs.

**Runs.** Three runs were made, and the numbers below are the last one, at 1066088 (`raw/tests-1066088.txt`, `raw/git-1066088.txt`). The earlier two:
- The first run, at d0c6ab5, had this lane's mutants 0 of 8, and its other numbers equal the ones below. Its output was overwritten by the second run and is kept only in the branch history (`raw/tests.txt` at 1336380).
- The second run, at 1336380 (`raw/tests.txt`, `raw/git.txt`), added "rule 5 off" on the new text.

After the review of #193 (comment 6484899627, at a5fad1e), one assertion and one mutant were added, and the third run was made.

**Tests** (`raw/tests-1066088.txt`, `run.sh`, node:24-slim, HEAD 1066088):
- `npm run typecheck`: exit 0.
- `vitest run --project node`: Test Files 2 failed | 22 passed (24); Tests 790 passed | 13 skipped (803).
  - The two failed files are `apps/site/test/knowledge.test.ts` (`spawnSync git ENOENT`) and `packages/cli/test/action.test.ts` (`Cannot read properties of undefined (reading 'trim')` from its `git` helper). The image has no git.
  - `npm run build` failed for the same reason (astro).
- `workspace-manifests.test.ts`: 22 passed. `judge.test.ts`: 63 passed.

**The checks that need git** (`raw/git.txt`, `git.sh`, image `ludion-l9-node24-git`: L9's node:24-slim with git 2.39.5, and a throwaway repository of the same files, HEAD 1066088; `raw/git-1066088.txt`):
- `knowledge.test.ts` and `action.test.ts`: Test Files 2 passed (2); Tests 13 passed | 6 skipped (19).
- `npm run build`: exit 0.

**Mutants** (`raw/tests-1066088.txt`). Each one must make a test in workspace-manifests.test.ts fail.

| Script | Survived | Notes |
| --- | --- | --- |
| L9's module mutants, 2026-10-28 `mutate.mjs` | 1 of 14 | The one counted as surviving is "rule 5 off", which was not applied: its text, `recordBefore[key]`, no longer exists, because this change reads own keys there. The script is a historical record and was not edited. The same mutant on the new text is in `mutate-l9b.mjs` and is killed. |
| L9's wiring mutants, 2026-10-29 `mutate-wiring.mjs` | 0 of 17 | |
| This lane's `mutate-l9b.mjs` | 0 of 10 | Four for `!` (ignored; only before; only after; only a leading `!`), four for own keys (`manifestChanges` before and after, rule 5 before and after), rule 5 stopping on any `__proto__` key (added after the review), and "rule 5 off" on the new text. |

## Not done

- No re-judgement of #161 or #162. Neither has a `!` entry or a `__proto__` key, so these inputs cannot change their findings. This was not run to confirm it.
- `.github/workflows/` and `action/` were not changed.
