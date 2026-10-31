# 2026-10-31 (LMR1d) — Impact Classes: conditions where a vector can give each class of a set, sets that hold every class a mechanism gives, and the count again

Continues PR #236 from its head 0129ba8, for ludion-ops#1 comments 6539943852 (a) and 6540209072 items 1 and 4. The decision is docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md, committed and pushed in 0566c3d before the code changed and before the count. No gate, wait or judgement changes, and nothing Ludion outputs changes yet (the record is not wired in).

- **Code** (packages/cli/src/security/impact.ts).
  - The conditions:
    - takeover: one system's C:H and I:H (CVSS 4: VC and VI, or SC and SI);
    - impersonate: C and I both affected;
    - steal: C affected;
    - alter: I affected;
    - disrupt: A affected.
  - With no vector, only a record whose CWEs together allow one class gets it.
  - trap is a MAL- id or alias, or CWE-506 to 512 (`TRAP_CWES`). CWE-912 is not trap.
  - The table holds every class a mechanism can give:
    - code and command injection and the other ways to run code, with 912: {takeover, steal, alter, disrupt};
    - authorization, XSS, authentication, sessions, passwords and credentials: {impersonate, steal, alter};
    - CSRF and open redirect: {impersonate, alter};
    - 59, 73, 276 and 732 join {steal, alter}.
  - `classify(record, table)` takes the table as an optional second argument, for the measurement's sets before widening and for the tests.
- **Tests** (packages/cli/test/impact.test.ts, 46).
  - The design rule, through the real `classify()`: the 31 sets built from five CWEs that each allow one class, and for each of the 80 pairs of a set and a class in it, a CVSS 3 vector among all 27 and a CVSS 4 vector among all 729 give that class. The same is checked for every set of the shipped table.
  - The conditions, case by case.
  - Line 82's CWE-862 C:L/I:N/A:N is now steal.
  - The no-vector rule, CWE-506 to 512 as trap, CWE-912 as not trap, and that the table given is the one used.
  - Four real fixtures changed class from their own fields: GHSA-223g-f5mq-gw33 alter, GHSA-225x-3jhx-wh4q steal, GHSA-2497-6pwj-pwg7 steal, GHSA-22gj-8qj2-fj46 alter.
- **Mutations**: **74 of 74** caught (docs/bench/2026-10-31-lmr1-impact-classes/logs/mutate.log, 07:24:04Z). The first run caught 73 of 74: "the table argument ignored" survived until a test checked a CWE whose set differs between the two tables.
- **Checks** (Docker only, `--network none`, `--memory=4g`):
  - test.sh (07:23:23Z): tsc 0; CLI tests 981 passed, 24 skipped.
  - full.sh (07:25:21Z, tree 558566e): typecheck 0, build 0, `npm test -- --maxWorkers=2` 1268 passed, 24 skipped.

## The count (counts.json, 2026-10-31T07:20:43Z, impact.ts e11540dd…, same zips, sha256 checked)

Records that are not MAL- (15,469: npm 8,073, Packagist 7,396), classified three ways: before LMR1d (0129ba8, `git show` into the volume, sha256 2326b824…), the new code with the sets before widening (comment 6539943852 (a) alone), and the new code with the shipped sets. Every record of the exports is counted, so no interval is given.

| | Before LMR1d | Sets before widening | Shipped sets |
|---|---|---|---|
| npm + Packagist | 11,625 (75.2%) | 10,846 (70.1%) | **11,288 (73.0%)** |
| npm | 6,208 (76.9%) | 5,873 (72.7%) | **6,067 (75.2%)** |
| Packagist | 5,417 (73.2%) | 4,973 (67.2%) | **5,221 (70.6%)** |

By class, npm + Packagist:

| Class | Before LMR1d | Before widening | Shipped |
|---|---|---|---|
| trap | 406 | 408 | 408 |
| takeover | 1,675 | 1,360 | 1,249 |
| impersonate | 5,477 | 3,826 | 3,769 |
| steal | 2,467 | 3,083 | 3,346 |
| alter | 684 | 1,246 | 1,589 |
| disrupt | 916 | 923 | 927 |
| unclassified | 3,844 | 4,623 | 4,181 |

Unclassified by reason (before widening / shipped):
- the vector rules out every class: 883 / 273;
- no vector, and two or more classes: 412 / 580;
- no CWE in the table: 1,952 / 1,952;
- no CWE: 1,376 / 1,376;
- an unreadable vector: 0 / 0.

Records whose CWEs together allow one class, made unclassified by the vector, by that class (before widening / shipped): takeover 236 / 0, impersonate 445 / 0, steal 60 / 60, alter 77 / 77, disrupt 10 / 10.

Records that are not MAL- and have no CVSS 3 or 4 vector: 2,128 of 15,469 (13.8%); npm 753 (9.3%), Packagist 1,375 (18.6%).

What changed:
- **Before LMR1d → shipped: 2,300 records.**
  - 2,177 went to a weaker class: impersonate → alter 806, impersonate → steal 595, impersonate → unclassified 344, takeover → steal 205, takeover → unclassified 110, takeover → alter 63, takeover → impersonate 37, takeover → disrupt 12, steal → unclassified 5.
  - 123 went to a stronger one: unclassified → steal 83, unclassified → alter 36, unclassified → trap 2, unclassified → takeover 1, disrupt → steal 1.
- **Before LMR1d → before widening: 2,141.**
  - Weaker: impersonate → unclassified 660, impersonate → alter 514, impersonate → steal 514, takeover → unclassified 240, takeover → impersonate 37, takeover → steal 23, takeover → alter 13, takeover → disrupt 8, steal → unclassified 5.
  - Stronger: unclassified → steal 83, unclassified → alter 35, unclassified → takeover 6, unclassified → trap 2, disrupt → steal 1.
- **Before widening → shipped: 784.**
  - Stronger: unclassified → alter 349, unclassified → steal 257, unclassified → disrupt 4, alter → steal 6.
  - Weaker: takeover → unclassified 111, impersonate → unclassified 57.

Every record that moved to a stronger class is in docs/bench/2026-10-31-lmr1-impact-classes/stronger.tsv (before → widening 127, before → shipped 123, widening → shipped 616), with its CWEs and vectors. Of the 123 before → shipped:
- one was already classified: GHSA-569q-mpph-wgww (CWE-73, 770; VC:H/VI:H/VA:H) went from disrupt to steal;
- the two new traps are GHSA-3hfp-gqgh-xc5g (CWE-508) and GHSA-428f-mh7w-6w2x (CWE-509);
- the one new takeover is GHSA-9wfr-w7mm-pc7f (CWE-88, 912; C:H/I:H/A:H).

trap among records that are not MAL-: 406 → 408 (12 by a MAL- alias, 394 by CWE-506, 2 by CWE-507 to 512).

## branch.test.ts

Since LMR1c-3's count of 25 runs and 1 failure, it ran 4 more times and passed each time: CI on 0129ba8, test.sh at 07:23Z, full.sh at 07:25Z, and one earlier test.sh in this lane, whose start time was not kept. That makes **29 runs, 1 failure**.
