# 2026-10-31 (LMR1f) — Impact Classes: takeover only when code running is the direct result of the mechanism; R236's review of 42e30b6

Continues PR #236 from its head 42e30b6, for ludion-ops#1 comment 6541666295 (the chat's answers to LMR1e-2's three questions) and the review of 42e30b6 (PR #236 comment 6541677765, REQUEST CHANGES). The decision is docs/decisions/2026-10-31-impact-classes-takeover-direct.md, committed and pushed in 05dde3b before the code changed and before the count. Nothing Ludion outputs changes yet (the record is not wired in).

## The chat's answers (6541666295)

- **(1)** takeover is in a CWE's set only when the attacker's code or commands running is the direct result of the mechanism. The sentence is added to point 6 of docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md (marked "Added by LMR1f"); the every-cwe-widened record points to the new one.
  - **Code** (`CWE_CLASSES`, still eleven rows):
    - 22 to 40, 59, 73, 276, 552, 732 → {steal, alter, disrupt}, the row of 611 and 918;
    - 15, 89, 943, 1321 → {impersonate, steal, alter, disrupt}, the row of XSS, authorization and authentication;
    - 434 and 912 keep all five;
    - 77, 78, 94, 95, 96, 98, 494, 502, 829, 917, 1336 keep {takeover, steal, alter, disrupt}.
  - No CWE entered or left the table.
- **(2)** The count below, with every record that moved to a stronger class listed one by one, and the moves to takeover counted apart.
- **(3)** disrupt for XSS, authorization and authentication, and steal for 601, stay.

## R236's points (comment 6541677765)

1. **Blocking: "Trap" in the class column with no published record.** Fixed by (a): `renderRecord` refuses a row whose class is trap unless its stop is `{ reason: "trap", record }` and `classify(record)` gives trap. It throws, as for a trap stop whose record is not a trap.
   - The fixture row ua-parser-js 0.7.29 (stop install-scripts) is now takeover.
   - A new test refuses the class trap on a row stopped for another reason and on fixed, opened and waited rows, in both languages, and shows it on three backed rows.
   - Three mutations loosen the check (the check removed; any stopped row; any row with a stop), and all three are caught.
   - Mistake record: docs/mistakes/2026-10-31-impact-classes-trap-in-the-class-column.md.
2. **A part with a second ":"** (`C:H:junk`) now makes the vector unreadable, whichever metric it names.
   - The first version (02c6337) also made a part with no ":" unreadable. `scripts/unreadable.sh` (`logs/unreadable-02c6337.log`) then found two real records whose CVSS 4 vectors end with "/": GHSA-g357-x5c3-c72p and GHSA-9p7c-v5x3-rfx8.
   - No record and no review asked for that. cc44cbd reads a part with no ":" as before, and tests hold both cases. `logs/unreadable.log` (cc44cbd) lists no record.
3. **`LABELS[lang]` found prototype keys.** `renderRecord` now takes only LABELS' own keys. "constructor", "__proto__", "toString", "hasOwnProperty", "", null and 1 each throw "Unknown language", with rows and with none.
4. **Bench README.** The heading now says LMR1 to LMR1f. "Checks" says the logs hold LMR1f's runs and that LMR1c's are in git history (c5fdfff).
5. **PR body.** The three out-of-date sentences are marked with what replaced them, and LMR1f's section is added.
6. **The mistakes record of LMR1e.** Its Check line no longer names a number. A "Since then" line says 12 sets and 33 pairs since LMR1e-2, and the same in LMR1f.
7. **The first Impact Classes record** now points to the conditions, every-cwe-widened and takeover-direct records. It says its unclassified list no longer holds for 506, 912, 59, 73, 276 and 732.

## Tests (packages/cli/test/impact.test.ts, 48)

- The sets the decision names: 15, 89, 943 and 1321 in the login set; 22, 23, 40, 59, 73, 276, 552 and 732 with 611 and 918; 95, 96 and 917 checked too.
- C:H/I:H/A:H gives steal for 22 and 276, and impersonate for 943, 1321 and 15; 434, 912 and 502 still give takeover; CVSS 4 for 22 and 89.
- The reasons that name these sets.
- The design rule's second check: the shipped table's rows still form **12 sets and 33 pairs** (the row shapes did not change), each pair given by a vector.
- No real fixture changed class. Of the five that list a changed CWE, none has both C:H and I:H (packages/cli/test/fixtures/impact/README.md).

**Mutations: 90 of 90** caught (logs/mutate.log, 2026-10-31T09:56:46Z, the code of cc44cbd).
- Six of LMR1e-2's row mutations and LMR1's "CWE-78 leaves the table" were rewritten for the rows' new first CWEs.
- LMR1f added 10:
  - path traversal and the file CWEs get takeover back;
  - 15, 89, 943 and 1321 get takeover back;
  - 434 and 912 lose takeover;
  - code injection loses takeover;
  - the three trap-class mutations above;
  - a part with a second ":" read as its first two fields;
  - a part with no ":" made unreadable;
  - a language found through the prototype.
- A first run on the code of 02c6337 (finished 09:55:04Z) also caught 90 of 90. The vector rule changed after it, so its log was replaced by the run above.

**Checks** (Docker only, `--network none`, `--memory=4g`):
- test.sh (logs/test.log, 10:00:10Z, tree 772a139): tsc 0; CLI tests 23 files, 983 passed, 24 skipped; impact.test.ts 48 passed.
- full.sh (logs/full.log, 10:00:49Z, tree 772a139): typecheck 0, build 0, `npm test -- --maxWorkers=2` 39 files, 1270 passed, 24 skipped.

## The count (counts.json, 2026-10-31T09:56:04Z, impact.ts 9538e75e…, same zips, sha256 checked)

Three impact.ts files, as the record defines:
- LMR1d: f25d51b, sha256 ffefa53e…;
- LMR1e-2: 42e30b6, sha256 d121e485…;
- after: the code of cc44cbd.

Records that are not MAL-, classified:

| | LMR1d | LMR1e-2 | After |
|---|---|---|---|
| npm + Packagist (15,469) | 11,288 (73.0%) | 11,340 (73.3%) | **11,340 (73.3%)** |
| npm (8,073) | 6,067 (75.2%) | 6,077 (75.3%) | **6,077 (75.3%)** |
| Packagist (7,396) | 5,221 (70.6%) | 5,263 (71.2%) | **5,263 (71.2%)** |

By class, npm + Packagist:

| Class | LMR1d | LMR1e-2 | After |
|---|---|---|---|
| trap | 408 | 408 | 408 |
| takeover | 1,249 | 1,964 | **1,249** |
| impersonate | 3,769 | 4,078 | **4,641** |
| steal | 3,346 | 2,618 | **2,770** |
| alter | 1,589 | 1,206 | 1,206 |
| disrupt | 927 | 1,066 | 1,066 |
| unclassified | 4,181 | 4,129 | 4,129 |

Unclassified by reason (LMR1d / LMR1e-2 / after):
- the vector rules out every class: 273 / 69 / 69;
- no vector and two or more classes: 580 / 732 / 732;
- no CWE in the table: 1,952 / 1,952 / 1,952;
- no CWE: 1,376 / 1,376 / 1,376;
- an unreadable vector: 0 / 0 / 0.

A set with one class, made unclassified by the vector (after): steal 16, disrupt 10, the others 0.

Records with no CVSS 3 or 4 vector: 2,128 of 15,469 (13.8%).

### Moves to takeover, counted apart

- **LMR1e-2 → after: 0.**
- **LMR1d → after: 0.** The 1,249 takeover records are the same records as in LMR1d: no change from LMR1d to after goes into or out of takeover.

### LMR1e-2 → after: 715 changed (npm 374, Packagist 341)

All weaker: takeover → impersonate 563, takeover → steal 152. None went to unclassified. These 715 are the records LMR1e-2 had made takeover (from steal 489, from alter 204, from impersonate 22); none of them is takeover now.

### LMR1d → after: 1,228 changed (npm 813, Packagist 415)

- 1,076 went to a stronger class: steal → impersonate 496, alter → impersonate 376, unclassified → disrupt 139, unclassified → steal 36, unclassified → alter 29.
- 152 went to unclassified: steal → unclassified 116, alter → unclassified 36. These are the records with no vector whose sets now hold several classes, as in LMR1e-2.
- Every one of the 1,076 is listed in docs/bench/2026-10-31-lmr1-impact-classes/stronger.tsv (column `comparison` = `lmr1d_to_after`), with its CWEs and vectors. LMR1e-2 → after has none.
- By CWE (a record counts under each CWE it lists), the most frequent:
  - steal → impersonate: CWE-89 375, CWE-311 47, CWE-434 30, CWE-522 16, CWE-943 11;
  - alter → impersonate: CWE-1321 331, CWE-915 68.

## branch.test.ts

LMR1e-2's record counted 37 runs and 1 failure. Since then it passed in CI on 42e30b6 and in the six runs here (test.sh at 09:50:19Z, 09:50:54Z, 09:53:03Z, 09:55:28Z and 10:00:10Z; full.sh at 10:00:49Z). That makes **44 runs, 1 failure**.
