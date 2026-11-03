# LOLD2: the oldest version in range, in `ludion patch` (2026-11-03)

The first item of C12. Definitions: docs/decisions/2026-11-03-oldest-resolution-in-product.md, committed at 6bc7f83 before any of the code was written and not changed since. Details and how to run it: docs/bench/lold2/README.md.

## What changed

- **The choice.** For each npm fix, `resolveOldest` (packages/cli/src/security/oldest.ts) walks what V requires, from package metadata alone, and writes a table of requirement to version: V for its own range, then a version already locked, then the oldest published at or before T with no OSV record, deprecation or withdrawal, then V's same release, then nothing.
- **npm takes the answer.** npm has no way to choose the oldest (LOLD). In the resolver's container, npm's own `install --package-lock-only` runs with `pacote.manifest` answering from the table. A question with no answer fails that question, and npm decides whether that fails its run. The acquisition flags are the same, and no candidate code runs in this step.
- **Stopping.** When nothing is left and npm's run fails on it, the fix stops with the requirement and the counts, and `fixes[].resolution.stopped_no_allowed` is true. No newer or excluded version is taken.
- **The asserts,** on the diff as npm wrote it, in `fixes[].resolution.assert`: each version's age against the judge's wait, with the youngest setting the line; every version other than V, a locked one or V's same release published at or before T; every version one the table gave. A failure stops that fix.
- **What may move.** npm's `unplannedRemovals` check, and the PR job's refusal of any other entry that moves, stopped every fix whose V needs a sibling at a higher version. Both now read `unneededMoves`: a path moves only when a package that loads it no longer takes its old version, and goes away only when all that loaded it has moved or gone. Composer keeps `unplannedRemovals`. In the PR job, a moved entry must be reached from the planned paths and is compared with the registry, as an added one is.

Nothing here changes the wait table or a gate's numeric criteria.

## The tests

No test leaves the machine. They read packument copies recorded on 2026-11-03 (packages/cli/test/fixtures/oldest-packuments) or written by hand, and a map for OSV.

| Asked for | Test |
|---|---|
| The oldest is chosen | `oldest-by-publish-time`, `oldest-recorded-transitive`, `patch-takes-oldest` |
| The oldest is known vulnerable: the next oldest | `oldest-vulnerable-next`, `patch-next-oldest` |
| Deprecated and withdrawn are passed over | `oldest-skips-deprecated-withdrawn`, `oldest-withdrawn-record` |
| Nothing left in range: stop | `oldest-nothing-left`, `patch-nothing-left` |
| A locked version does not move | `oldest-keeps-locked`, `moves-forced`, `moves-unneeded`, `moves-removed`, `patch-keeps-locked` |
| The youngest version sets the line | `assert-youngest-sets-the-line`, `patch-waits`, `patch-age-assert` |
| The resolution time, a push too early, the landing version | `assert-resolution-time`, `assert-push-too-early`, `assert-landing`, `assert-landing-stops`, `patch-landing` |

Counts, in Docker with no network, on the tree of this record: `npm run typecheck` passes, `npm run build` passes, and `npm test` gives 50 files and 2,329 tests passed, with 1 file and 30 tests skipped. New: 33 in packages/cli/test/oldest.test.ts, 11 in dependencies.test.ts, and 1 in deliver.test.ts, whose existing test of npm's lockfile rule also has new cases for a moved entry. One existing expectation changed: the order of the resolver's steps in dependencies.test.ts names the new script.

**Mutations:** 36 of 36 caught (docs/bench/lold2/mutations.json), each a check broken in turn with the tests then run. On the first run 34 of 36: one mutation's text did not match, and the age assert's stop was never reached because the judge's own wait comes first. `patch-age-assert` now holds it, by a registry whose answer changes between the two reads.

## The real run

The product's code on LOLD's 24 examples, with the real npm 12.2.1, the real registry and the real OSV, at the same T as LOLD (docs/bench/lold2/summary.json). The advisories are OSV's here and the registry's advisory endpoint's in LOLD.

| Counted examples: 23 (one more has no base) | Here | LOLD |
|---|---|---|
| Built | 13 (11 with a version other than V moved, 9 with a path that moved) | 13 (11) |
| Stopped: nothing allowed is left | 10 | 10 |
| Failed | 0 | 0 |
| npm asked for a requirement the table did not hold | 0 | - |

- **Every outcome** is the same as LOLD's, in all 24.
- **In the 13 built:** 40 versions moved; 0 unneeded moves, 0 requirements left unmet, 0 assert problems; `npm ci --dry-run` exits 0, `npm ls` reports no problem, and `npm install --package-lock-only` exits 0 and leaves each lockfile byte for byte the same.
- **The judge on the 13 built:** 9 `ready_except_build`, 4 `stop`. In three (R01, R03, R04) V itself is deprecated today, which is hindsight: the real command's next-fix rule looks at that before the candidate, and this run does not run it. **In one (R19) a version this rule chose is what stops it:** gate 1 stops `create-hash` going down from 1.2.0 to 1.1.3 at a new nested path, and `hash-base` and `ripemd160` the same way, since pbkdf2 3.1.3 requires a lower range than the copies already locked. Whether the judge stops npm's normal lockfile for R19 too was not run. Gate 1 is unchanged.
- **The table:** 1 to 589 requirements, and 0.04 to 84 seconds to write.

**The real Dockerfile,** built uncached with Docker as `ludion patch` builds it, on two examples: T1 builds, its lockfile has braces 3.0.3 and fill-range 7.1.1, and package.json keeps no override; R05's build fails, and the last 1,500 bytes of Docker's text, all the host keeps, name `@angular/common@20.3.0 (nothing allowed)`.

## What this does not show

- **A whole `ludion patch` run was not done** with the new code: its steps ran as above, and the command itself ran with a stand-in for Docker in the tests. No run on GitHub either.
- **That the oldest version works.** Gate 3 is as it was. A project's own tests are all that run on it, as for any fix.
- **A rate.** LOLD's examples were chosen for having a new or changed range, with each base one dependency taken when new, and with today's advisories and deprecations rather than T's.
- **The PR job works out no table,** so a forged artifact whose moved version is not the oldest but is in range, old enough and passes the judge is not refused there. The validation job holds this.

## The two lines

- **The stop rate here:** 10 of 23, on those examples. Not a population rate, and not LSAMPLE's.
- **The line for moving to the other way:** a 95% lower bound above 20% on LSAMPLE's stop rate. LSAMPLE does not exist yet, so it is measured when it does.

## Open

1. **"T ≤ push − wait".** Read with T as first sight, it conflicts with the plan's own count of fixes whose wait is over when the advisory appears. The decision's section 3 says what the product does instead; the receipt writes the literal comparison, and it stops nothing. The reading is the owner's.
2. **T** is a lower bound until first sight is recorded (another item of C12).
3. **A range with nothing left** stops, and what else to do with it is the owner's (LOLD).
