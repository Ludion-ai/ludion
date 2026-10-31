# 2026-10-31 — LFLAGS: the PR job checks npm's flags against the lock's graph, and an optional peer adds nothing

Under docs/decisions/2026-10-31-lock-flags-from-graph.md (committed at 9ed2aa2, before the runs, the tests and the code). Detail: docs/bench/2026-10-31-lflags/README.md.

- **Optional peers (audit 6541743253, item 1).** Rule 1: the PR job's walk follows only what npm installs, so a package reached only through an optional peer is stray. Rule 2: the requirement check holds an optional peer that the lookup finds to the package its spec names, in range; one it finds nothing for is met. npm 12.2.1 refuses with ERESOLVE the fix whose optional peer finds another package (X4), so rule 2 refuses nothing npm writes, and the decision's fallback did not apply. The audit's B, C and E and the variants P and R are refused in v2 and v3; npm ls reports C and E only.
- **Flags (the brain's comment 6539200199, item 1, next step).** `computedFlags` follows npm 12.2.1's arborist. F1: on 102 locks npm 7.10.0 to 12.2.1 wrote, no entry's written flags differ from the computed ones (32 of the locks are npm 12.2.1's). The PR job requires the computed flags on every entry a fix moves, adds or changes in its flags, and on every one whose place in the graph changes them.
- **N1 and N2 (review 6541119866).** npm 12.2.1's X1 (`optional` dropped) and X2 (`peer` dropped) fixes are taken, and a changed `name` on an unplanned entry is refused.
- **Mutations:** see docs/bench/2026-10-31-lflags/logs/mutate.log.
- **Not built here:** gate 2's checks of an entry whose flags alone changed (docs/decisions/2026-10-31-lock-flags-only.md, section 4).
