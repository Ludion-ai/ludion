# Judge v0 backtest (2026-10-28)

The design's first gate for the judge (docs/design.md, "ロードマップと検証ゲート" 1): would gate 2 and the wait have stopped the known malicious npm releases of 2025, and what do the same rules cost genuine fixes?

## Malicious releases: `malicious.json`

`node tools/backtest/src/malicious.ts <osv-npm-dir> <cache-dir> <out.json>`, OSV npm export downloaded 2026-10-27 (MAL- records), registry.npmjs.org packuments read 2026-10-27/28.

Selection: every OSV MAL- record published in 2025 that names specific versions of a package (3,668 records), kept when the package had a clean version published at least 7 days before the malicious one (a compromised package, not a package made to be malicious). Dropped: 600 versions whose package the registry no longer serves, 4,198 with no earlier clean version, 3 with no publish time.

For each malicious version, the judge is asked when the wait ends, counted from the version's publish time (kept by the registry even for removed versions), with only what was public then. The measured signal is the re-query of OSV: the MAL- record's `published` time. Removal and deprecation times are not in the registry and are not used, and removed versions' scripts, publisher and provenance are unknown, so the numbers are a **lower bound**. "With provenance inference" also stops a removed version that replaced one with build provenance, assuming it was published without provenance (a stolen token cannot produce it).

Versions published in 2025: **1,412 malicious versions in 969 packages**. Hours from publish to the MAL- record: p10 5.6, median 11.5, p90 38.4.

| Wait (urgency) | Stopped, measured | With provenance inference |
| --- | --- | --- |
| 12h (exploited) | 776 (55.0%) | 802 (56.8%) |
| 24h (high) | 1,182 (83.7%) | 1,191 (84.3%) |
| 72h (normal) | 1,329 (94.1%) | 1,329 (94.1%) |
| 168h (dev-only) | 1,342 (95.0%) | 1,342 (95.0%) |

Named incidents, hours from publish to MAL- record: debug 4.4.2 1.2, chalk 5.6.1 4.0, duckdb 1.3.3 9.3, posthog-node (Shai-Hulud 2.0) 12.3–12.5, nx (s1ngularity) 16.1–18.2 with provenance on the previous version, eslint-config-prettier 62.2–62.5 with provenance on the previous version, is 60.6–67.6. By wave: 2025-09-08/09 (chalk, debug, duckdb) 23 of 26 at 12h, 26 at 72h; 2025-09-14/19 (Shai-Hulud) 50 of 186 at 12h, 75 at 24h, 186 at 72h; 2025-11-21/25 (Shai-Hulud 2.0) 628 of 985 at 12h, 984 at 24h.

Not stopped within 7 days: 70 versions of 2025 whose MAL- record came later. Also reported apart: 56 versions published before 2025 that first got a record in 2025 (dormant code or backfilled records); 15 of them are stopped, and no wait of days can catch the rest.

**Gate result: not met.** "Stop every known malicious release" fails at every wait; 72h stops 94%. The 12h exploited wait stops about half.

## Genuine fixes: `fixes.json`

`node tools/backtest/src/fixes.ts <osv-npm-dir> <out.json> 200`, same OSV export; registry, attestations, OSV, CISA KEV and FIRST EPSS read live on 2026-10-27.

Sample: the first 200 (by a hash of id, package and fixed version) of 826 fixed npm versions in GHSA records published in 2025, kept when the fixed version was published in 2025 and an earlier version of the same major exists. Each is the update from the highest earlier version of that major to the fixed version, judged by the live judge with only the fixed package in the diff.

| | |
| --- | --- |
| Urgency | exploited 8, high 34, normal 158, low 0 |
| Delay (wait from the fix's publish, when not stopped) | median **72h**, p90 144h (n = 167): 12h ×3, 24h ×20, 72h ×127, 144h ×17 |
| Wait extended | 25 (publisher change 21, new dependencies 11; some both) |
| Stopped | 33: deprecated 30, provenance lost 1, new install script 1, no longer listed 1 |

Of the 30 deprecation stops, 24 carry messages like "This version has a security vulnerability" or "High Security Vulnerability in React Server Components": the fixed version itself was deprecated later, after a further advisory. The backtest uses today's deprecation state, so these count as stops although the deprecation did not exist when the wait ended. At the time, about 3 of 200 would have stopped. The stop reasons were recomputed from the rows (`stop_reasons_note`).

**Gate result: not met.** The design asks for a median delay within 24h. With the initial waits, most fixes are "normal" (72h) and the median is 72h. Reaching 24h means a shorter normal wait, which the malicious backtest prices: at 24h the re-query stops 84% of 2025's malicious releases instead of 94% at 72h.

## Not measured yet

The design's third number, notifications cut to a third or less (the noise measurement over 100 public repositories with Dependabot PRs), is not part of this backtest.
