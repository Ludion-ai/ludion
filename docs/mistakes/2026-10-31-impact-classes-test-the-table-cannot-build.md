# 2026-10-31 — A decision record promised a test the same record's table could not build

- **What happened.** docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md (PR #236, 0566c3d) said its design rule is tested by building each of the 31 sets of the five table classes from CWEs that each allow one class. Its own point 7 widened every takeover and impersonate CWE into a set of several classes, so no CWE in the shipped table allows only takeover or only impersonate. The lane's test then built the 31 sets from a table written in the test and passed to `classify()`, which matched neither the record's words nor the shipped table. The shipped table was checked only row by row (7 sets), not for the 13 sets its rows' unions can form. The audit found it (ludion-ops#1 comment 6540622832, point 2).
- **Why.** The test method was written down when 78 and 287 still each allowed one class (comment 6540032469). The record's point 7 changed the table afterwards, and nobody checked point 1 against point 7.
- **Fixed** in LMR1e:
  - The record's point 1 now says where each check runs.
  - `chooseClass`, the step `classify()` runs after the union, is exported, and the 31 sets and 80 pairs are run through it directly.
  - The real `classify()` with real CWEs runs every set the shipped table's rows can form (13 sets, 33 pairs). A row added later that forms a set with no vector for one of its classes fails the test.
- **Check:** `packages/cli/test/impact.test.ts` — "the design rule" tests: the 80 pairs at `chooseClass`, and every set and pair the shipped table's rows can form, through `classify()` (13 sets and 33 pairs when this was written).
- **Since then.** LMR1e-2's table (docs/decisions/2026-10-31-impact-classes-every-cwe-widened.md) forms 12 sets and 33 pairs, and LMR1f's (docs/decisions/2026-10-31-impact-classes-takeover-direct.md) the same 12 and 33; the test asserts the current numbers. Pointed out by the review of 42e30b6 (PR #236 comment 6541677765, point 6).
