# 2026-10-31 (LMR1g) — Impact Classes: impersonate, like takeover, only when it is the direct result of the mechanism

Continues PR #236 from its head 84ef289, for ludion-ops#1 comment 6542470518, point 6 item 3. The chat answered LMR1f's report: SQL injection (89) and prototype pollution (1321) had risen to impersonate. The decision is docs/decisions/2026-10-31-impact-classes-impersonate-direct.md, committed and pushed in 5466dc8 before the code changed and before the count. Nothing Ludion outputs changes yet (the record is not wired in).

## What changed

- **Record** (5466dc8):
  - The sentence for point 6 of the conditions record now covers impersonate: takeover and impersonate are in a set only when they are the direct result of the mechanism.
  - The changed sets, each with its reason.
  - The CWEs that keep impersonate. Those with impersonate that the chat did not name are listed and kept (434, 912, 90, 91, 311, 319, 642, 256, 257, 312, 522, 643, 652, 471, 472, 915).
  - The chain of records, which the review of 42e30b6 asked for (point 7).
- **Edits undone.** LMR1f had written into four earlier records:
  - docs/decisions/2026-10-31-impact-classes.md;
  - docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md;
  - docs/decisions/2026-10-31-impact-classes-every-cwe-widened.md;
  - docs/mistakes/2026-10-31-impact-classes-test-the-table-cannot-build.md.

  Records are not rewritten (comments 6542062338 point 1 and 6543282859 point 5), so these four are back to their text at 42e30b6. The new record says what those additions said.
- **Code** (packages/cli/src/security/impact.ts, `CWE_CLASSES`, 3b8a327):
  - 15, 89 and 943 → {steal, alter, disrupt}, the row of 22 to 40, 611 and 918;
  - 1321 → {alter, disrupt}, a new row (twelve rows now).
  - No CWE entered or left the table.
- **Tests** (packages/cli/test/impact.test.ts, 49):
  - The new sets.
  - CVSS 3 and 4 cases: CWE-89 C:H/I:H and C:L/I:L give steal; 943 and 15 C:H/I:H/A:H give steal; 1321 gives alter, and C:H/I:N/A:N gives unclassified; 89 + 287 C:H/I:H still gives impersonate through 287.
  - A new test: none of the 27 CVSS 3 or 729 CVSS 4 vectors gives takeover or impersonate to 89, 943, 15 or 1321, nor steal to 1321.
  - The design rule's second check: the shipped table's rows now form **13 sets and 35 pairs**. The {alter, disrupt} row adds one set and two pairs. Each pair is still given by a vector. The test first failed on the count alone (expected 12 and 33, got 13 and 35); every pair check passed.
  - No real fixture changed class (packages/cli/test/fixtures/impact/README.md).
- **Mutations: 96 of 96** caught (logs/mutate.log, 2026-10-31T12:55:12Z, the code of 3b8a327).
  - Five mutations that named a moved row were rewritten for the row they now start with.
  - LMR1f's "SQL injection, 15, 943 and 1321 get takeover back" became "the login set gets takeover".
  - LMR1g added 6: 15, 89 and 943 get impersonate back; 1321 gets impersonate back; 1321 gets steal back; 1321 loses disrupt; 1321 leaves the table; the login set loses impersonate.
- **Checks** (Docker only, `--network none`, `--memory=4g`, `--maxWorkers=2`):
  - test.sh (logs/test.log, 12:57:27Z, tree 7502b8d): tsc 0; CLI tests 23 files, 984 passed, 24 skipped; impact.test.ts 49 passed.
  - full.sh (logs/full.log, 12:57:49Z, tree 7502b8d): typecheck 0, build 0, `npm test -- --maxWorkers=2` 39 files, 1271 passed, 24 skipped.

## The count (counts.json, 2026-10-31T12:54:24Z, impact.ts 41d0eee6…, same zips, sha256 checked)

Three impact.ts files, as the record defines:
- LMR1d: f25d51b, sha256 ffefa53e…;
- LMR1f: 84ef289, sha256 9538e75e…;
- after: the code of 3b8a327.

Records that are not MAL-, classified:

| | LMR1d | LMR1f | After |
|---|---|---|---|
| npm + Packagist (15,469) | 11,288 (73.0%) | 11,340 (73.3%) | **11,335 (73.3%)** |
| npm (8,073) | 6,067 (75.2%) | 6,077 (75.3%) | **6,072 (75.2%)** |
| Packagist (7,396) | 5,221 (70.6%) | 5,263 (71.2%) | **5,263 (71.2%)** |

By class, npm + Packagist:

| Class | LMR1d | LMR1f | After |
|---|---|---|---|
| trap | 408 | 408 | 408 |
| takeover | 1,249 | 1,249 | 1,249 |
| impersonate | 3,769 | 4,641 | **3,960** |
| steal | 3,346 | 2,770 | **3,152** |
| alter | 1,589 | 1,206 | **1,493** |
| disrupt | 927 | 1,066 | **1,073** |
| unclassified | 4,181 | 4,129 | **4,134** |

Unclassified by reason (LMR1d / LMR1f / after):
- the vector rules out every class: 273 / 69 / 74;
- no vector and two or more classes: 580 / 732 / 732;
- no CWE in the table: 1,952 / 1,952 / 1,952;
- no CWE: 1,376 / 1,376 / 1,376;
- an unreadable vector: 0 / 0 / 0.

A set with one class, made unclassified by the vector (after): steal 16, disrupt 10, the others 0.

Records with no CVSS 3 or 4 vector: 2,128 of 15,469 (13.8%). `logs/unreadable.log` (3b8a327) lists no record.

### LMR1f → after: 693 changed (npm 390, Packagist 303)

All went to a weaker class:
- impersonate → steal 394;
- impersonate → alter 287;
- steal → disrupt 7;
- steal → unclassified 5. The vector now rules out every class the CWEs allow: 74 records, where LMR1f had 69. Which CWEs these 5 list was not counted.

**To takeover: 0. To impersonate: 0.** No record moved to a stronger class.

### LMR1d → after: 545 changed (npm 433, Packagist 112)

- 393 went to a stronger class:
  - unclassified → disrupt 146;
  - steal → impersonate 105;
  - alter → impersonate 86;
  - unclassified → alter 29;
  - unclassified → steal 24;
  - alter → steal 3.
- 152 went to unclassified: steal → 116, alter → 36. These are records with no vector whose sets now hold several classes, as since LMR1e-2.
- **To takeover: 0. To impersonate: 191** (from steal 105, from alter 86; npm 151, Packagist 40).
- Every one of the 191 is listed in docs/bench/2026-10-31-lmr1-impact-classes/strong-side.md (made from stronger.tsv by scripts/list-strong.mjs), with its CWEs. All 393 are in stronger.tsv with their vectors.
- By CWE (a record counts under each CWE it lists), the most frequent:
  - steal → impersonate: CWE-311 47, CWE-434 30, CWE-522 16, CWE-312 6, CWE-319 5;
  - alter → impersonate: CWE-915 68, CWE-1321 44, CWE-91 9, CWE-471 7.
- None of the 191 lists 89, 943 or 15. Each of the 44 that list 1321 also lists 915 or 471, which allow impersonate: CWE-915 and 1321 40; CWE-471 and 1321 2; CWE-20, 915 and 1321 2.

## branch.test.ts

LMR1f's record counted 44 runs and 1 failure. Since then it passed in CI on 84ef289 and in the four runs here (test.sh at 12:52:42Z, 12:53:12Z and 12:57:27Z; full.sh at 12:57:49Z). That makes **49 runs, 1 failure**.
