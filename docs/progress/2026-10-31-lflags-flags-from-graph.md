# 2026-10-31 — LFLAGS (#240): an optional peer adds nothing; gate 2 checks every entry whose flags alone changed

Under docs/decisions/2026-10-31-lock-flags-from-graph.md (9ed2aa2; section 1) and docs/decisions/2026-10-31-flag-only-entries-gate2.md (662009a), each committed before its code. Detail: docs/bench/2026-10-31-lflags/README.md.

- **Optional peers (audit 6541743253, item 1).**
  - Rule 1: the PR job's walk follows only what npm installs, so a package reached only through an optional peer is stray.
  - Rule 2: the requirement check holds an optional peer the lookup finds to the package its spec names, in range. One it finds nothing for is met.
  - npm 12.2.1 refuses with ERESOLVE the fix whose optional peer finds another package (X4), so rule 2 refuses nothing npm writes.
  - The audit's B, C and E and the variants P and R are refused, in v2 and v3. npm ls reports C and E only.
- **Gate 2 on flag-only entries** (docs/decisions/2026-10-31-lock-flags-only.md, section 4): `ludion judge`, npm `patch`'s judge and the PR job's judge ask the registry and OSV for each such version. They stop on a MAL- record, withdrawal or deprecation, cannot decide without facts, and report advisories.
- **N1 and N2 (review 6541119866):** npm 12.2.1's X1 fix (`optional` dropped) and X2 fix (`peer` dropped) are taken. A changed `name` on an unplanned entry is refused.
- **Narrowed (the brain's comment 6542470518, 6, item 4):** the flags computed from the lock's graph are a separate lane. Their code, F1 (no difference on 102 npm-written locks) and their 25 mutations at 39ee847 are recorded in the bench folder for that lane.
- **Mutations of #240 as it is:** 18 of 18 caught. Number 8 was caught after a test was added for it.
