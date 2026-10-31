# 2026-11-01 — LFLAKY: branch.test.ts no longer fails when the test repository's commit id starts with 00

**Lane LFLAKY**, from main 71fc751. This fixes a bug found by a first-principles audit of main. Mistake: docs/mistakes/2026-11-01-branch-test-objects-00-flaky.md. No decision record: the goal, scope, gates, waits and rules are unchanged.

## What changed

- packages/cli/test/git.ts: `commit(root, date?)` takes an optional date, used as both GIT_AUTHOR_DATE and GIT_COMMITTER_DATE. Without it the environment is inherited as before, so the other tests are unchanged.
- packages/cli/test/branch.test.ts: the case "A fan-out entry that is not a folder" builds its repository at `@1767225635 +0000`, where the commit id is 00455d85…, and asserts that the id starts with `00`. It writes its file at the first two-hex name that `objects/` does not have (`01` here), and expects `objects/<that name> (not a folder)`.
- The source (packages/cli/src/security/branch.ts) is unchanged.

The audit gave two ways to fix it: use a free name, or fix the commit dates in `commit()` for every test. This lane uses both, but only in the one case. A free name alone fixes the bug. The fixed date makes the case run in the bad case (objects/00 already a folder) on every run, not in 1 run in 256. Fixing the date for every test was not done. `commit()` is used by five test files, and with one date for all of them, two commits of the same tree, parent and message would get one id. Whether any test depends on two such commits being different was not checked, so the other tests keep their clock dates.

## Results (all in Docker, node:24 sha256:e7add2a4…, git 2.39.5, a copy of the repository in the volume ludion-lflaky-w, `--memory 4g`, `--network none` except for `npm ci --ignore-scripts`)

Dates that give a commit id starting with 00, searched one second apart from 2026-01-01T00:00:00Z with project()'s files and git.ts's settings: 5 hits in 1,281 tries (36, 143, 84, 271 and 747 tries each; 1,281 / 256 = 5.0 expected).

| Run | Head | Result |
|---|---|---|
| branch.test.ts, the case at the 00 date with the old line `objects/00` (test first) | 250a7aa | 1 failed, 22 passed: `EISDIR: illegal operation on a directory, open '/tmp/ludion-branch-test-hGsDBF/.git/objects/00'`, the error of the CI runs |
| branch.test.ts with the fix, 3 runs | 9563175 | 23 passed, 3 of 3 |
| The old line at each of the 5 dates | 9563175, edited in the container | 5 of 5 failed with EISDIR |
| The fix at each of the 5 dates | 9563175, edited in the container | 5 of 5 passed (23 passed) |
| Mutation: branch.ts no longer refuses a fan-out entry that is not a folder | 9563175, edited in the container | caught: 1 failed, 22 passed |
| `npm run typecheck` | 9563175 | exit 0 |
| `npm run build` | 9563175 | exit 0 |
| `npx vitest run` (every suite) | 9563175 | 42 files passed; 1445 passed, 25 skipped (1470) |

The CI runs that failed on it: deploy 41225586091 (main 8a6192c, 1 failed, 1453 passed) and test 41023531546 (lane/ld-delta-check 7f662a3, 1 failed, 1161 passed). Both logs show the EISDIR at `.git/objects/00`.

## Not done

- No other test was searched for the same kind of fault (a fixed name in a folder whose contents change with the clock).
