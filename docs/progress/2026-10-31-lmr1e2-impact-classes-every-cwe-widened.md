# 2026-10-31 (LMR1e-2) — Impact Classes: every CWE in the table gets every class its mechanism can give

Continues PR #236 from its head f25d51b, for ludion-ops#1 comment 6540818608 point 2 (the chat's answers to LMR1d's three questions). The decision is docs/decisions/2026-10-31-impact-classes-every-cwe-widened.md, committed and pushed in fdf2e10 before the code changed and before the count; it gives every CWE its set with a one-line reason from its definition. The conditions, the design rule and its two checks do not change. Nothing Ludion outputs changes yet (the record is not wired in).

- **Code** (packages/cli/src/security/impact.ts, `CWE_CLASSES`). Eleven rows, strongest first in each set:
  - {T, I, S, A, D}: 15, 89, 434, 912, 943, 1321;
  - {T, S, A, D}: code and command injection, 494, 502, 829, and the file-reaching CWEs (22 to 40, 59, 73, 276, 552, 732);
  - {I, S, A, D}: XSS, authorization, authentication, sessions, passwords and credentials;
  - {I, A, D}: 352;
  - {I, S, A}: 90, 91, 311, 319, 601, 642;
  - {I, S}: 256, 257, 312, 522, 643, 652;
  - {I, A}: 471, 472, 915;
  - {S, A, D}: 611, 918;
  - {S, D}: 125 to 127;
  - {S}: pure exposure;
  - {D}: resource consumption.

  No CWE entered or left the table.
- **Tests** (packages/cli/test/impact.test.ts, 47).
  - The sets the record names.
  - Each class's rule on CWEs from the new rows.
  - The no-vector rule, now unclassified for more CWEs.
  - The design rule's second check: the shipped table's rows now form **12 sets and 33 pairs** (LMR1d's formed 13 and 33), each pair given by a vector. The record notes this as found by the tests after it was committed.
  - Three real fixtures changed class from their own fields: GHSA-22h7-7wwg-qmgg unclassified (CWE-1321, no vector), GHSA-2444-8gj8-6fmx steal (CWE-91, C:H/I:N), GHSA-265m-7826-wjqm impersonate (CWE-915, VC:H/VI:H).
- **Mutations**: **80 of 80** caught (logs/mutate.log, 08:55:54Z). Eight are on the new rows: path traversal and code injection lose alter or disrupt; the login set loses steal, alter and disrupt; CSRF can steal; the five-class row loses impersonate; SSRF and XXE lose disrupt; out-of-bounds reads lose disrupt; 912 leaves the table. The first run had one mutation that no longer matched the moved row ("CWE-78 leaves the table", NOT APPLIED); its text was corrected and the second run caught all 80.
- **Checks** (Docker only, `--network none`, `--memory=4g`):
  - test.sh (08:53:06Z): tsc 0; CLI tests 982 passed, 24 skipped.
  - full.sh (08:57:59Z, tree 6ca2bbf): typecheck 0, build 0, `npm test -- --maxWorkers=2` 1269 passed, 24 skipped.

## The count (counts.json, 2026-10-31T08:57:14Z, impact.ts d121e485…, same zips, sha256 checked)

Every record is classified by the impact.ts of f25d51b (before, `git show` into the volume as `osv/impact-before-lmr1e2.ts`, sha256 ffefa53e…) and by the new one (after). LMR1d's results are kept as `counts-before-lmr1e2.json`, `stronger-before-lmr1e2.tsv` and their logs.

Records that are not MAL-, classified:

| | Before | After |
|---|---|---|
| npm + Packagist (15,469) | 11,288 (73.0%) | **11,340 (73.3%)** |
| npm (8,073) | 6,067 (75.2%) | **6,077 (75.3%)** |
| Packagist (7,396) | 5,221 (70.6%) | **5,263 (71.2%)** |

By class, npm + Packagist (before → after):

| Class | Before | After |
|---|---|---|
| trap | 408 | 408 |
| takeover | 1,249 | 1,964 |
| impersonate | 3,769 | 4,078 |
| steal | 3,346 | 2,618 |
| alter | 1,589 | 1,206 |
| disrupt | 927 | 1,066 |
| unclassified | 4,181 | 4,129 |

Unclassified by reason (before / after):
- the vector rules out every class: 273 / 69;
- no vector, and two or more classes: 580 / 732;
- no CWE in the table: 1,952 / 1,952;
- no CWE: 1,376 / 1,376;
- an unreadable vector: 0 / 0.

Records whose CWEs together allow one class, made unclassified by the vector (before / after): takeover 0 / 0, impersonate 0 / 0, steal 60 / 16, alter 77 / 0, disrupt 10 / 10.

Records with no CVSS 3 or 4 vector: 2,128 of 15,469 (13.8%); npm 753 (9.3%), Packagist 1,375 (18.6%).

**What changed: 1,402 records** (npm 916, Packagist 486).
- 1,250 went to a stronger class: steal → takeover 489, alter → takeover 204, alter → impersonate 172, steal → impersonate 159, unclassified → disrupt 139, unclassified → steal 36, unclassified → alter 29, impersonate → takeover 22.
- 152 went to unclassified: steal → unclassified 116, alter → unclassified 36. These are records with no vector whose sets now hold two or more classes.

Every record that moved to a stronger class is listed in docs/bench/2026-10-31-lmr1-impact-classes/stronger.tsv, with its CWEs and vectors.

## branch.test.ts

Since LMR1e's 33 runs and 1 failure, it ran 4 more times and passed each time: CI on f25d51b, two test.sh (08:53Z and one earlier whose start time was not kept) and full.sh at 08:57Z. That makes **37 runs, 1 failure**.
