# 2026-10-31 (LFLAGS, #240) — Gate 2 checks every npm lock entry whose flags alone changed; the identity rule's sentence, corrected

Committed before the code that follows it. It builds docs/decisions/2026-10-31-lock-flags-only.md, section 4 (the brain's ludion-ops#1 comment 6540209072, item 3), which #240 takes on in place of the flags computed from the lock's graph (the brain's comment 6542470518, 6, item 4; docs/decisions/2026-10-31-lock-flags-from-graph.md, section 2, moved to a separate lane). It changes no gate's criteria and no wait.

## 1. The rule

A **flag-only entry** is an install path of package-lock.json's `packages` (not a link) that both the base and the change have, with the same package (its `name`, or the path's name), version, `resolved` and `integrity`, whose flags `dev`, `optional`, `devOptional` and `peer` differ (each read as set when `true`).

`ludion judge`, npm `ludion patch`'s judge (candidate-judge.ts) and the PR job's judge, which all read a lock change through judge-cli.ts's `packageLockInputs`, give the judge every flag-only entry. For each, the judge asks the registry and OSV for that name and version, as for a changed version (only the name and version are sent), and:
- an OSV MAL- record naming the version: **stop** (gate 2);
- the registry no longer lists the version (unpublished or withdrawn): **stop**;
- the registry marks the version deprecated: **stop**;
- no registry facts for it: **undecidable**;
- OSV's other advisories naming the version: **info**, as for an advisory a changed version keeps from the version it replaces (the version is the same).

What does not apply: the wait (the version's publish time is not new, so it does not set the newest publish), the time cap's rules 1 and 2 (nothing moves), and the comparisons with a predecessor (provenance, publisher, install scripts, new dependencies), since it is its own predecessor. When the wait ends and the judge runs again, it asks again, as for every changed version.

Why: gate 2's own sentence, "Check every package in the lockfile diff". A forged lock can write any flag, so the checks are not limited by a flag's direction (docs/decisions/2026-10-31-lock-flags-only.md, section 4).

## 2. Tests and mutations

- judge.test.ts: a flag-only entry with a MAL- record, withdrawn, deprecated, or without facts, each with the judge's verdict; one with an advisory, info only; and `packageLockInputs` finding B1's three entries in npm 12.2.1's node-fetch locks (extra/node-fetch, v2 and v3) and nothing in an unchanged lock.
- A mutation for each, run in Docker with no network (docs/bench/2026-10-31-lflags/scripts/mutate.mjs).

## 3. The identity rule's sentence (docs/decisions/2026-10-31-lock-corpus-alias.md, section 1)

That record is not rewritten; this entry corrects it. Its sentence "A location whose package is another one refuses the change, in `packages` and in a v2 lock's npm 6 tree, at the top and nested" was true on main of every requirement but an optional peer, which the requirement check left out (audit 6541743253, item 1; docs/mistakes/2026-10-31-optional-peer-location.md). Since #240 (docs/decisions/2026-10-31-lock-flags-from-graph.md, section 1), it holds for an optional peer too wherever Node's lookup finds a copy for it; an optional peer that finds nothing is met. Read the sentence with that addition.
