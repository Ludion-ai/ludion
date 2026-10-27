# Judge v0 backtest (2026-10-28)

The design's first gate for the judge (docs/design.md, "ロードマップと検証ゲート" 1): would gate 2 and the wait have stopped the known malicious npm releases of 2025, and what do the same rules cost genuine fixes?

## Malicious releases: `malicious.json`

`node tools/backtest/src/malicious.ts <osv-npm-dir> <cache-dir> <out.json>`, OSV npm export downloaded 2026-10-27 (MAL- records), registry.npmjs.org packuments read 2026-10-27/28.

Selection: every OSV MAL- record published in 2025 that names specific versions of a package (3,668 records), kept when the package had a clean version published at least 7 days before the malicious one. That is mostly hijacked maintainer accounts, but the selection also keeps some dependency-confusion placeholders (for example 999999999.x versions of otherwise unused names). Dropped: 600 versions whose package the registry no longer serves, 4,198 with no earlier clean version, 3 with no publish time.

For each malicious version, the judge is asked when the wait ends, counted from the version's publish time (kept by the registry even for removed versions), with only what was public then. The measured signal is the re-query of OSV. A record can gain versions after it is published and OSV does not say when, so two timings are reported: optimistic (the record's `published` time for every version in it) and conservative (the record's `modified` time for the 182 versions that may have been added later: published after the record, or more than an hour after the record's earliest version). Removal and deprecation times are not in the registry and are not used, and removed versions' scripts, publisher and provenance are unknown, which under-counts stops; the optimistic timing can over-count them. These are estimates, not bounds. "With provenance inference" (optimistic timing) also stops a removed version that replaced one with build provenance, assuming it was published without provenance (a stolen token cannot produce it).

Versions published in 2025: **1,412 malicious versions in 969 packages**. Hours from publish to the MAL- record (optimistic): p10 5.6, median 11.5, p90 38.4; 13 versions were published after their record already existed.

| Wait (urgency) | Stopped, conservative | Stopped, optimistic | Optimistic, with provenance inference |
| --- | --- | --- | --- |
| 12h (exploited) | 737 (52.2%) | 776 (55.0%) | 802 (56.8%) |
| 24h (high) | 1,098 (77.8%) | 1,182 (83.7%) | 1,191 (84.3%) |
| 72h (normal) | 1,267 (89.7%) | 1,329 (94.1%) | 1,329 (94.1%) |
| 168h (dev-only) | 1,317 (93.3%) | 1,342 (95.0%) | 1,342 (95.0%) |

Named incidents, hours from publish to MAL- record (optimistic): debug 4.4.2 1.2, chalk 5.6.1 4.0, duckdb 1.3.3 9.3, posthog-node (Shai-Hulud 2.0) 12.3–12.5, nx (s1ngularity) 16.1–18.2 with provenance on the previous version, eslint-config-prettier 62.2–62.5 with provenance on the previous version, is 60.6–67.6. By wave (optimistic): 2025-09-08/09 (chalk, debug, duckdb) 23 of 26 at 12h, 26 at 72h; 2025-09-14/19 (Shai-Hulud) 50 of 186 at 12h, 75 at 24h, 186 at 72h; 2025-11-21/25 (Shai-Hulud 2.0) 628 of 985 at 12h, 984 at 24h.

Not stopped within 7 days: 70 versions of 2025 (optimistic; 95 conservative). Also reported apart: 56 versions published before 2025 that first got a record in 2025 (dormant code or backfilled records); 15 of them are stopped, and no wait of days can catch the rest.

**Gate result: not met.** "Stop every known malicious release" fails at every wait; 72h stops 90–94%. The 12h exploited wait stops about half.

## Genuine fixes: `fixes.json`

`node tools/backtest/src/fixes.ts <osv-npm-dir> <out.json> 200`, same OSV export; registry, attestations, OSV, CISA KEV and FIRST EPSS read live on 2026-10-27.

Sample: the first 200 (by a hash of id, package and fixed version) of 826 fixed npm versions in GHSA records published in 2025, kept when the fixed version was published in 2025 and an earlier version of the same major exists. Each is the update from the highest earlier version of that major to the fixed version, judged by the live judge with only the fixed package in the diff.

| | |
| --- | --- |
| Urgency | exploited 8, high 34, normal 158, low 0 |
| Delay (wait from the fix's publish, when not stopped) | median **72h**, p90 144h (n = 165): 12h ×3, 24h ×20, 72h ×125, 144h ×17 |
| Wait extended | 26 |
| Stopped | 35: deprecated 30 (10 of them also with advisories on the fixed version), advisories on the fixed version only 2, provenance lost 1, install script with no comparable predecessor 1, no longer listed 1 |

The run uses today's registry and OSV facts. Of the 30 deprecation stops, 24 carry messages like "This version has a security vulnerability" or "High Security Vulnerability in React Server Components": the fixed version was deprecated after a further advisory. The 12 "advisories on the fixed version" are likewise advisories published after the fix. Those did not exist when the wait ended. At the time, between 3 (only provenance, install script and the unlisted version) and 11 (also the 6 deprecations without a vulnerability message and the 2 advisory-only stops) of 200 would have stopped; the backtest cannot tell when the other deprecations were made.

This is the second run, after the round-1 review of #143 added gate 1's advisory and downgrade checks and the strict tarball and integrity checks (gate 4 findings are left out here because the sample has no real lockfile). The first run (median 72h, 33 stops) printed an empty stop-reason list because of a summary bug, since fixed; this file is generated as is.

**Gate result: not met.** The design asks for a median delay within 24h. With the initial waits, most fixes are "normal" (72h) and the median is 72h. Reaching 24h means a shorter normal wait, which the malicious backtest prices: at 24h the re-query stops 78–84% of 2025's malicious releases instead of 90–94% at 72h.

## Not measured yet

The design's third number, notifications cut to a third or less (the noise measurement over 100 public repositories with Dependabot PRs), is not part of this backtest.
