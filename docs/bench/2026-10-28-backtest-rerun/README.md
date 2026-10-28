# Judge backtest rerun (2026-10-28)

The rerun the owner asked for, with the definitions fixed before it ran: docs/decisions.md, "Backtest rerun: definitions fixed before running it" (committed as ccc463e at 11:55 JST and pushed before either script ran; merged as #144). The wait table is unchanged. The first run is in `../2026-10-28-judge-backtest/`.

Data: the OSV npm export downloaded 2026-10-27 (`all.zip`, sha256 `8b3170a641d33df3d327f805e98a4165f2eb3e725d57d7f11e27e906d7fbba23`, 230,822 records), the same export as the first run; registry.npmjs.org packuments and attestations read 2026-10-28; for the fixes, registry, OSV, CISA KEV and FIRST EPSS read live on 2026-10-28. Both scripts ran in Docker (node:24-slim, read-only root, non-root, no forwarded host environment; network only for the registry and advisory reads).

## Result: not met

| Gate (registered) | Result | |
| --- | --- | --- |
| Every malicious version in the denominator stopped, at each urgency's wait | **not met** | 928 / 1,148 at 12h and 24h, 1,044 at 72h, 1,070 at 168h |
| Exploited: median added delay within 24h | met | 16.4h (n = 6) |
| High: median added delay within 24h | met | 0h (n = 21) |
| Normal: median added delay within 72h | met | 41.5h (n = 138) |

All three must hold, so the rerun does **not meet** the design's gate. The delay gates are met; the malicious gate is not.

## Malicious releases: `malicious-v2.json`

`node tools/backtest/src/malicious-v2.ts <osv-npm-dir> <cache-dir> <out.json>`

From 3,668 MAL- records published in 2025 that name explicit npm versions:

| | Versions | Packages |
| --- | --- | --- |
| Denominator: earlier legitimate version (≥ 7 days) and selectable by Ludion | **1,148** | 767 |
| — selectable directly (an OSV fixed event is exactly this version) | 0 | |
| — selectable as a transitive dependency moving in the diff (newest version satisfying `^prev` when published) | 1,148 | |
| New fake packages (no legitimate version 7 days earlier), counted only | 4,198 | 2,382 |
| Earlier legitimate version, but not selectable (not the newest under `^prev`, or a prerelease) | 320 | 230 |
| Unknown: package no longer served by the registry / no publish time | 600 / 3 | |

Of the 1,148, 1,111 were published in 2025; 37 are older versions that first got a record in 2025. 1,140 of the 1,148 have been removed from the registry, so their own provenance, scripts, publisher and dependencies are unknown and fire nothing (registered rule).

Stopped, primary count (conservative record timing, no inference):

| Urgency (base wait) | Stopped | Not stopped | Optimistic timing | With provenance inference |
| --- | --- | --- | --- | --- |
| Exploited (12h; 24h when provenance is not comparable) | 928 (80.8%) | 220 | 968 | 935 |
| High (24h) | 928 (80.8%) | 220 | 968 | 935 |
| Normal (72h) | 1,044 (90.9%) | 104 | 1,075 | 1,047 |
| Low (168h) | 1,070 (93.2%) | 78 | 1,084 | 1,073 |

Exploited and high are equal: no version in the denominator has comparable provenance (almost all are removed), so the exploited wait is 24h for every one of them.

Contribution of each signal (fires / stops it alone):

| Signal | 12h / 24h | 72h | 168h |
| --- | --- | --- | --- |
| OSV re-query when the wait ends | 927 / 927 | 1,044 / 1,043 | 1,070 / 1,069 |
| Provenance regression | 0 / 0 | 0 / 0 | 0 / 0 |
| Install scripts added | 1 / 1 | 1 / 0 | 1 / 0 |
| Wait extended (publisher change, new dependencies, predecessor unlisted): stops caught only within the extension | 18 | 3 | 2 |
| Deprecation (no time in the registry; upper bound, not counted) | 1 deprecated today | | |

So the stops are the re-query's. The other gate 2 signals cannot be observed on removed versions, and only 8 of the 1,148 are still in the registry.

Hours from publish to the MAL- record (conservative): p10 6.2, median 11.5, p90 64.2. The conservative timing takes a record's `modified` time when a version may have been added to it later (137 versions differ from the optimistic timing); when a record was edited much later, this pushes the time far out (nx 21.6.0–21.8.0: 16h optimistic, about 8,045h conservative). 38 versions are missed at 24h only because of that. Both timings are shown; the registered primary is the conservative one.

Named incidents (optimistic hours to record; all removed from the registry; all in the denominator as transitive): debug 4.4.2 1.2, chalk 5.6.1 4.0, duckdb 1.3.3 9.3, posthog-node 5.13.3 12.4, nx 21.5.0–21.8.0 16.1–18.2, eslint-config-prettier 10.1.6/10.1.7 62.2, is 3.3.1 67.6.

## Genuine fixes: `fixes-v2.json`

`node tools/backtest/src/fixes.ts <osv-npm-dir> <out.json> 200`: the first run's sample procedure (first 200 by hash of 826 npm fixed versions in 2025 GHSA records), judged with 2026-10-28 facts. Added delay = max(0, fix publish + wait − advisory publish).

| Urgency | Updates | Stopped | Added delay n | Median | 90th percentile |
| --- | --- | --- | --- | --- | --- |
| Exploited | 8 | 2 | 6 | 16.4h | 75.4h |
| High | 34 | 13 | 21 | 0h | 40.9h |
| Normal | 158 | 20 | 138 | 41.5h | 91.3h |
| Low | 0 | 0 | 0 | not measured | not measured |

Stops: 35 of 200, for the same kinds of reason as the first run (deprecations made after a further advisory, advisories published after the fix, one lost provenance, one install script without a comparable predecessor, one unlisted version); today's facts, so most of them would not have existed when the wait ended (first run README). 12 of the 13 high-urgency stops are deprecations, 11 of them citing a security vulnerability (next 15.x, react-server-dom-*); the other is the unlisted taylored 7.0.8. The added delay is short because GHSA advisories are usually published days after the fix: the wait has partly or fully run out by the time the advisory appears. 10 of the 200 had the advisory published before the fix; for those the formula also counts the time between the two. Low (dev-only) is not in this sample, which models production dependencies only; it has no gate.

The judge's own wait (from the fix's publish) is unchanged from the first run: median 72h, p90 144h (n = 165).

## Reading

- The malicious gate fails for the same reason as in the first run: the stops come from the OSV re-query, and about a fifth of the selectable malicious versions got their record more than 24h after publish (a tenth more than 72h). Gate 2's other signals add almost nothing here because the registry has removed the versions they would be read from.
- The delay gates pass with the current waits once the delay is counted from the advisory instead of the fix.
- Nothing here changes the wait table; that is the owner's decision.
