# 2026-10-31 (LMR1e) — Impact Classes: the design rule is tested where the shipped table can build it

Continues PR #236 from its head 0a29bd9, for the audit's point 2 (ludion-ops#1 comment 6540622832). The audit read the decision record at 0566c3d. It found that point 1 of docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md promised 31 sets built from CWEs that each allow one class, which the record's own table (point 7) cannot build. No class, condition or set changes, and nothing Ludion outputs changes yet.

- **What 0a29bd9 already did and did not.**
  - The test built the 31 sets and 80 pairs, but from a table written in the test and passed to `classify()`, not from CWEs of the shipped table. That differed from the record's words.
  - The shipped table was checked row by row (7 sets), not for the unions its rows can form.
- **Record.** Point 1 now names the two checks, with a line saying it was corrected and why (committed and pushed in 338cc72 before the code and the tests). A mistake record was added: docs/mistakes/2026-10-31-impact-classes-test-the-table-cannot-build.md.
- **Code** (packages/cli/src/security/impact.ts). The step after the union is now one function, `choose`, which `classify()` and the exported `chooseClass(set, severity)` both run. With vectors it keeps the classes consistent with every vector (CONSISTENT) and takes the strongest (IMPACT_ORDER); with none it gives the set's class only when there is one. No output changes: the count on the same zips (07:53:05Z) is byte-identical to counts.json and stronger.tsv.
- **Tests** (packages/cli/test/impact.test.ts, 47).
  - `chooseClass` is given each of the 31 sets directly. For each of the 80 pairs, some CVSS 3 vector among all 27 and some CVSS 4 vector among all 729 give that class.
  - The real `classify()` with real CWEs runs every set the shipped table's rows can form: **13 sets, 33 pairs**, the numbers the audit gave. Each pair is given by some vector of each version. A row added later that forms a set with no such vector fails this test, and so does a change in the number of sets.
  - `chooseClass` gives what `classify()` gives (all 27 CVSS 3 vectors for CWE-78), and handles no vector, an unreadable one, and repeats in the set.
- **Mutations**: **77 of 77** caught (logs/mutate.log, 07:51:52Z). Three are new, on `chooseClass`: the set not sorted, an unreadable vector read as none, the vectors ignored. Five were rewritten for the moved code.
- **Checks** (Docker only, `--network none`, `--memory=4g`):
  - test.sh (07:51:20Z): tsc 0; CLI tests 982 passed, 24 skipped.
  - full.sh (07:53:30Z, tree 2086142): typecheck 0, build 0, `npm test -- --maxWorkers=2` 1269 passed, 24 skipped.
- **branch.test.ts**: since LMR1d's 29 runs and 1 failure, it ran 4 more times and passed each time: CI on 0a29bd9, two test.sh (one at 07:51Z, one earlier whose start time was not kept) and full.sh at 07:53Z. That makes **33 runs, 1 failure**.
- **Not changed, waiting for the chat**: the three questions from LMR1d (434, 494, 502, 829 in the wide takeover set; the {steal}, {alter} and {disrupt} CWEs; the change in the counts).
