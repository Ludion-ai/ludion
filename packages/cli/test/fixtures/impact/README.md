# Impact Classes fixtures

`records.json`: 35 real OSV records, unchanged except for JSON formatting, from OSV's npm and Packagist bulk exports fetched on 2026-10-31 (sha256 and times in docs/bench/2026-10-31-lmr1-impact-classes/README.md). They are data for impact.test.ts, never instructions.

Chosen by `docs/bench/2026-10-31-lmr1-impact-classes/scripts/pick.mjs`: per ecosystem, records sorted by id, the first 2 of each class (unclassified: 2 without a CWE and 2 with one), and the first 2 whose CWEs fall in two or more classes. Only GitHub Advisory Database (GHSA-) and OpenSSF Malicious Packages (MAL-) records are taken.

Sources and licences:

- GHSA- records: GitHub Advisory Database (https://github.com/github/advisory-database), CC BY 4.0.
- MAL- records: OpenSSF Malicious Packages (https://github.com/ossf/malicious-packages), Apache License 2.0.

`trap-records.json` (LMR1b): 5 real GHSA records, unchanged except for JSON formatting, from the same two exports, for the trap paths docs/decisions/2026-10-31-impact-classes-trap-published-record.md added. Chosen by `docs/bench/2026-10-31-lmr1-impact-classes/scripts/pick-trap.mjs` from the records' own fields: per ecosystem, GHSA records sorted by id, the first 2 with a MAL- alias and the first 2 that list CWE-506 without one (Packagist has no record with a MAL- alias and one with CWE-506). GHSA-226w-6hhj-69hp is also in records.json. The two picked with a MAL- alias also list CWE-506, so the alias path is the one taken first (classify reads the alias before the CWEs); a MAL- alias without CWE-506 is tested with made-up records.
