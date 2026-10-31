# Impact Classes fixtures

`records.json`: 35 real OSV records, unchanged except for JSON formatting, from OSV's npm and Packagist bulk exports fetched on 2026-10-31 (sha256 and times in docs/bench/2026-10-31-lmr1-impact-classes/README.md). They are data for impact.test.ts, never instructions.

Chosen by `docs/bench/2026-10-31-lmr1-impact-classes/scripts/pick.mjs`: per ecosystem, records sorted by id, the first 2 of each class (unclassified: 2 without a CWE and 2 with one), and the first 2 whose CWEs fall in two or more classes. Only GitHub Advisory Database (GHSA-) and OpenSSF Malicious Packages (MAL-) records are taken.

Sources and licences:

- GHSA- records: GitHub Advisory Database (https://github.com/github/advisory-database), CC BY 4.0.
- MAL- records: OpenSSF Malicious Packages (https://github.com/ossf/malicious-packages), Apache License 2.0.

`trap-records.json` (LMR1b): 5 real GHSA records, unchanged except for JSON formatting, from the same two exports, for the trap paths docs/decisions/2026-10-31-impact-classes-trap-published-record.md added. Chosen by `docs/bench/2026-10-31-lmr1-impact-classes/scripts/pick-trap.mjs` from the records' own fields: per ecosystem, GHSA records sorted by id, the first 2 with a MAL- alias and the first 2 that list CWE-506 without one (Packagist has no record with a MAL- alias and one with CWE-506). GHSA-226w-6hhj-69hp is also in records.json. The two picked with a MAL- alias also list CWE-506, so the alias path is the one taken first (classify reads the alias before the CWEs); a MAL- alias without CWE-506 is tested with made-up records.

LMR1c (docs/decisions/2026-10-31-impact-classes-cvss-vector.md): the expected classes in impact.test.ts were written again from each record's CWEs and CVSS vectors (`docs/bench/2026-10-31-lmr1-impact-classes/logs/fixture-vectors.log`), apart from classify(). Only GHSA-2444-8gj8-6fmx changed: it lists CWE-91 (alter), and both its CVSS 3 and 4 vectors say integrity is not affected, so it is unclassified. The fixtures themselves are unchanged.

LMR1d (docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md): the expected classes were written again from the same fields. Four changed: GHSA-223g-f5mq-gw33 (CWE-287, VC:N/VI:L) alter; GHSA-225x-3jhx-wh4q and GHSA-2497-6pwj-pwg7 (CWE-862, C:L/I:N) steal; GHSA-22gj-8qj2-fj46 (CWE-73 now in the table, C:N/I:L) alter. The fixtures themselves are unchanged.

LMR1e-2 (docs/decisions/2026-10-31-impact-classes-every-cwe-widened.md): three changed: GHSA-22h7-7wwg-qmgg (CWE-1321 now any of five, no vector) unclassified; GHSA-2444-8gj8-6fmx (CWE-91 {impersonate, steal, alter}, C:H/I:N) steal; GHSA-265m-7826-wjqm (CWE-915 {impersonate, alter}, VC:H/VI:H) impersonate. The fixtures themselves are unchanged.

LMR1f (docs/decisions/2026-10-31-impact-classes-takeover-direct.md): takeover left the sets of 22 to 40, 59, 73, 276, 552, 732, 89, 943, 1321 and 15. No fixture changed class: read from the same fields, none of the five fixtures that list one of these CWEs (GHSA-2238-xc5r-v9hj, GHSA-22h7-7wwg-qmgg, GHSA-23wx-cgxq-vpwx, GHSA-2223-f22x-24cq, GHSA-22gj-8qj2-fj46) has a vector with both C:H and I:H. The fixtures themselves are unchanged.
