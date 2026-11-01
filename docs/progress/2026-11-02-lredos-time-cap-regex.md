# 2026-11-02 — LREDOS: the Composer name check decides in linear time

**Lane LREDOS**, from main c9be544, after a first-principles audit found two high `js/redos` alerts of CodeQL open on packages/cli/src/security/time-cap.ts:175 since 2026-10-29. Mistake: docs/mistakes/2026-11-02-composer-name-regex-backtracking.md.

## What changed

- packages/cli/src/security/time-cap.ts: the expression's repeats no longer hold a `+`, and `isComposerName` (new, exported for the test) also refuses a name over 240 characters before the expression runs. `packagistReleases` calls it.
- packages/cli/test/time-cap-composer-name.test.ts (new, 6 tests, every name has `composer-name-regex-linear`).

Old: `/^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/`

New: `/^[a-z0-9](?:[_.-]?[a-z0-9])*\/[a-z0-9](?:(?:[_.]|-{1,2})?[a-z0-9])*$/`

The one change in what is accepted: a name over 240 characters with the right shape, which the old check let through to Packagist, is refused. inventory.ts already refuses such a name in a lockfile; a name in a version's Packagist `require` had no limit.

## Times (Docker, `--network none`, `--memory 4g`, the expression alone, one run each for the old, three for the new)

| Input | Old, Node 24.22.2 | New, the same Node |
|---|---|---|
| `a` × 20 + `-/x` | 14.8 ms | |
| `a` × 24 + `-/x` | 233 ms | |
| `a` × 26 + `-/x` | 926 ms | |
| `a` × 28 + `-/x` | 3,694 ms | |
| `a` × 30 + `-/x` | 14,788 ms | |
| `a` × 32 + `-/x` | stopped at 45 s | 0.032 to 0.039 ms |
| `x/` + `a` × 24 + `-` | 326 ms | |
| `x/` + `a` × 28 + `-` | 4,687 ms | |
| `x/` + `a` × 30 + `-` | 18,629 ms | |
| `x/` + `a` × 32 + `-` | not run | 0.033 to 0.035 ms |
| `a` × 240 + `-/x` | not run | 0.004 to 0.005 ms |
| `a` × 10,000 + `-/x` | not run | 0.068 to 0.089 ms |
| `a` × 1,000,000 + `-/x` | not run | 6.5 to 6.8 ms |

The audit measured 234 ms, 3.7 s and 14.8 s at 24, 28 and 30; these runs agree. The new expression's time from 10,000 to 1,000,000 grows about in proportion to the length.

## Red, then green (Docker, `--network none`, `--memory 4g`)

The new test and the mutations ran on Node 24.22.2 (node:24-slim); typecheck, build and the suites on Node 24.22.1 (the same with git, since the site's build and the branch tests need it).

| Run | Code | Result |
|---|---|---|
| The new test, before the fix | the old expression, no length limit, behind `isComposerName` | 4 failed, 2 passed. Failed: the three timed names ("took over 50 ms in each of 3 tries", 153 to 156 ms each, stopped by the VM's limit) and the 241-character name. Passed: the two comparisons, old against itself. |
| The new test, with the fix | this PR | 6 passed. The three timed names took 1 to 3 ms in the test, the limit's wrapper included. |
| `npm run typecheck` | this PR | exit 0 |
| `npm run build` | this PR | exit 0 |
| dependencies, check, records and the new test | this PR | 4 files, 229 tests passed |
| `npx vitest run` (every suite, no Docker socket) | this PR | 46 files passed; 1944 tests passed, 25 skipped (1969) |

## Old against new

| Inputs | Compared | Mismatches | Accepted by both |
|---|---|---|---|
| Random names, fixed seed 20261102 (mulberry32), each of at most 66 characters, so the old expression stays fast | 200,000 | 0 | 21,865 |
| Every string of up to 7 characters over `a`, `-`, `_`, `.`, `/` and a line feed | 335,923 | 0 | not counted |

## Mutations of the code

Each run against the new test and undone: 17 of 17 caught.

| Mutation | Failed tests |
|---|---|
| M1 the old expression, with the length limit kept | 2 |
| M2 no length limit | 1 |
| M3 limit 241 | 1 |
| M4 limit 239 | 1 |
| M5 `-{1,3}` | 2 |
| M6 `-` in place of `-{1,2}` | 2 |
| M7 vendor without `-` | 2 |
| M8 vendor taking `--` | 2 |
| M9 no `$` | 3 |
| M10 no `^` | 2 |
| M11 flag `i` | 1 |
| M12 flag `m` | 2 |
| M13 package without `_` | 2 |
| M14 package without `.` | 2 |
| M15 vendor separator required | 3 |
| M16 package separator required | 3 |
| M17 `packagistReleases` skips the check | 3 |

## Not done

- `ludion patch` was not run end to end on such a name, and no real Packagist answer was used; the fetch is a stand-in.
- The four other open CodeQL alerts (`js/incomplete-sanitization`, in scripts under docs/bench run by hand) are not touched.
- Nothing yet fails when a code scanning alert is open; the new test holds this one expression only.
