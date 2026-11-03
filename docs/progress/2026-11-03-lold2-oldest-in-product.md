# LOLD2: the oldest version in range, in `ludion patch` (2026-11-03)

The first item of C12. Definitions: docs/decisions/2026-11-03-oldest-resolution-in-product.md, committed at 6bc7f83 before any of the code was written. Details and how to run it: docs/bench/lold2/README.md.

## What changed

- **The choice.** For each npm fix, `resolveOldest` (packages/cli/src/security/oldest.ts) walks what V requires, from package metadata alone, and writes a table of requirement to version: V for its own range, then a version already locked, then the oldest published at or before T with no OSV record, deprecation or withdrawal, then V's same release, then nothing.
- **npm takes the answer.** npm has no way to choose the oldest (LOLD). In the resolver's container, npm's own `install --package-lock-only` runs with `pacote.manifest` answering from the table. A question with no answer fails that question, and npm decides whether that fails its run. The acquisition flags are the same, and no candidate code runs in this step.
- **Stopping.** When nothing is left and npm's run fails on it, the fix stops with the requirement and the counts, and `fixes[].resolution.stopped_no_allowed` is true. No newer or excluded version is taken.
- **The asserts,** on the diff as npm wrote it, in `fixes[].resolution.assert`: each version's age against the judge's wait, with the youngest setting the line; every version other than V, a locked one or V's same release published at or before T; every version one the table gave. A failure stops that fix.
- **What may move.** npm's `unplannedRemovals` check, and the PR job's refusal of any other entry that moves, stopped every fix whose V needs a sibling at a higher version. Both now read `unneededMoves`: a path moves only when a package that loads it no longer takes its old version, and goes away only when all that loaded it has moved or gone. Composer keeps `unplannedRemovals`. In the PR job, a moved entry must be reached from the planned paths and is compared with the registry, as an added one is.
- **The PR job works the oldest out again.** That loosened check would otherwise rest on the validation job alone, whose artifact the PR job treats as untrusted (an audit of the first head found this; the decision's added section says what changed). `recheckOldest` calls the same `resolveOldest` from the registry's metadata and OSV, starting from the V the artifact names, which also sets T, and taking the advisories from OSV rather than the receipt, and `notOldest` refuses a fix when a version it brings in, other than V or one the base locks, is not the answer for a requirement of what loads it. `ludion patch` holds the same check. It runs no package's code, and sends only names and versions, and back to OSV the IDs it returned.

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
| The PR job refuses a forged later version, under a given V | `pr-job-rechecks-moved-version-is-oldest`, `not-oldest-reads-the-loader's-range`, `not-oldest-added`, `not-oldest-allows`, `not-oldest-t-from-osv`, `patch-answer-per-requirement` |

Counts, in Docker with no network, at e2ec262: `npm run typecheck` passes, `npm run build` passes, and `npm test` gives 50 files and 2,335 tests passed, with 1 file and 30 tests skipped. Two more tests came after that head (`not-oldest-withdrawn-record`, `not-oldest-package-named-constructor`); the whole suite on the later head is CI's, on the PR. New in all: 39 in packages/cli/test/oldest.test.ts, 12 in dependencies.test.ts, and 2 in deliver.test.ts, whose existing test of npm's lockfile rule also has new cases for a moved entry. One existing expectation changed: the order of the resolver's steps in dependencies.test.ts names the new script.

**Mutations:** 48 of 48 caught (docs/bench/lold2/mutations.json), each a check broken in turn with the tests then run: 44 at e2ec262, and on the later head the 2 new ones and the 2 whose text changed. On the first run of the first head's 36, 34: one mutation's text did not match, and the age assert's stop was never reached because the judge's own wait comes first. `patch-age-assert` now holds it, by a registry whose answer changes between the two reads.

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
- **The PR job's check on the 13 built:** `notOldest` found 0, and `recheckOldest`, with its own table and OSV's advisories and times, refused 0, so no real lockfile here was refused by it. In the 24 examples this run took two sittings: the first stopped at its time limit after 16, on which R09 failed with `api.osv.dev answered HTTP 503`, and the rest, with R09 again, ran next.
- **The judge on the 13 built:** 9 `ready_except_build`, 4 `stop`. In three (R01, R03, R04) V itself is deprecated today, which is hindsight: the real command's next-fix rule looks at that before the candidate, and this run does not run it. **In one (R19) a version this rule chose is what stops it:** gate 1 stops `create-hash` going down from 1.2.0 to 1.1.3 at a new nested path, and `hash-base` and `ripemd160` the same way, since pbkdf2 3.1.3 requires a lower range than the copies already locked. Whether the judge stops npm's normal lockfile for R19 too was not run. Gate 1 is unchanged.
- **The table:** 1 to 589 requirements, and 0.04 to 84 seconds to write.

**The real Dockerfile,** built uncached with Docker as `ludion patch` builds it, on two examples: T1 builds, its lockfile has braces 3.0.3 and fill-range 7.1.1, and package.json keeps no override; R05's build fails, and the last 1,500 bytes of Docker's text, all the host keeps, name `@angular/common@20.3.0 (nothing allowed)`.

## What this does not show

- **A whole `ludion patch` run was not done** with the new code: its steps ran as above, and the command itself ran with a stand-in for Docker in the tests. No run on GitHub either.
- **That the oldest version works.** Gate 3 is as it was. A project's own tests are all that run on it, as for any fix.
- **A rate.** LOLD's examples were chosen for having a new or changed range, with each base one dependency taken when new, and with today's advisories and deprecations rather than T's.
- **That V itself is the smallest fixed version, in the PR job.** It takes the fix's package and V from the receipt, checked against the lockfile and the branch name, as it did on main, and it checks the form of the advisory IDs, not their values. So a forged artifact can name a later V, which moves T too, or name a sibling as the fix, which leaves `recheckOldest` nothing to read. These are held only by what else runs on them; whether the judge stops the second was not run. A separate piece of work (LVCHECK).
- **A version the base locks** can be placed at a moved path without being the answer for what loads it: it brings in no new code, and the judge still reads it.
- **How long the PR job's check takes on a large fix.** Writing the table took up to 84 seconds here, and it now runs in the PR job too, whose time limit is 15 minutes. A job that runs out fails, and nothing is pushed for the fixes it did not reach.

## The two lines

- **The stop rate here:** 10 of 23, on those examples. Not a population rate, and not LSAMPLE's.
- **The line for the other way:** the earlier line, on a 95% lower bound of 20%, is withdrawn. The other way is tried only on fixes the rule stopped because nothing is left, and goes in with 5 or more successes on them (the decision's last section). LSAMPLE does not exist yet, so it is measured when it does, and until then a fix stops as it does today.

## Open

1. **"T ≤ push − wait".** Read with T as first sight, it conflicts with the plan's own count of fixes whose wait is over when the advisory appears. The decision's section 3 says what the product does instead; the receipt writes the literal comparison, and it stops nothing. This reading was decided on 2026-11-03 under the owner's delegation of wait judgments, so this item is no longer open.
2. **T** is a lower bound until first sight is recorded (another item of C12).
3. **A range with nothing left** stops. Whether the other way goes in for those fixes is LSAMPLE's measurement (above).
