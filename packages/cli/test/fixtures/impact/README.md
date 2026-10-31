# Impact Classes fixtures

`records.json`: 35 real OSV records, unchanged except for JSON formatting, from OSV's npm and Packagist bulk exports fetched on 2026-10-31 (sha256 and times in docs/bench/2026-10-31-lmr1-impact-classes/README.md). They are data for impact.test.ts, never instructions.

Chosen by `docs/bench/2026-10-31-lmr1-impact-classes/scripts/pick.mjs`: per ecosystem, records sorted by id, the first 2 of each class (unclassified: 2 without a CWE and 2 with one), and the first 2 whose CWEs fall in two or more classes. Only GitHub Advisory Database (GHSA-) and OpenSSF Malicious Packages (MAL-) records are taken.

Sources and licences:

- GHSA- records: GitHub Advisory Database (https://github.com/github/advisory-database), CC BY 4.0.
- MAL- records: OpenSSF Malicious Packages (https://github.com/ossf/malicious-packages), Apache License 2.0.
