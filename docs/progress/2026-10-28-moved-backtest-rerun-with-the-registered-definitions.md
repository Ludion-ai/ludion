## 2026-10-28 — Backtest rerun with the registered definitions

Ran after the definitions were committed (ccc463e, #144): `tools/backtest/src/malicious-v2.ts` (new) and `tools/backtest/src/fixes.ts` (now also records the advisory's publish time and the added delay). Same OSV export as the first run; registry and live advisory data read 2026-10-28; both in Docker. Results and raw data: docs/bench/2026-10-28-backtest-rerun/.

Malicious denominator: 1,148 versions in 767 packages, all selectable only as transitive dependencies (none is an OSV fixed version); 4,198 versions of new fake packages counted apart; 600 unknown. Stopped (conservative timing): 928 (80.8%) at 12h/24h, 1,044 (90.9%) at 72h, 1,070 (93.2%) at 168h. Almost every stop is the OSV re-query; 1,140 of the 1,148 are removed from the registry, so provenance, scripts and publisher cannot be read for them. Added delay for genuine fixes (median): exploited 16.4h (n = 6), high 0h (n = 21), normal 41.5h (n = 138), low not in the sample.

Gate: **not met**. The delay gates are met; "every malicious version stopped" is not, at any wait. The wait table is unchanged.

