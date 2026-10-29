## 2026-10-28 — Backtest rerun: definitions fixed before running it

The owner asked for the judge backtest to be rerun with the definitions below. They are committed before the rerun and are not changed after seeing its results; a later change is a new entry with a new run. The wait table (docs/design.md, "待機時間") is not changed by this entry. Scope: npm, the 2025 OSV data, the same sources as the first run (docs/bench/2026-10-28-judge-backtest).

**1. Malicious denominator.** Start from OSV MAL- records published in 2025 that name explicit npm versions. A malicious version V of package P is counted only when both hold:

- P had a legitimate version before V: a version named by no MAL- record and published at least 7 days before V (the first run's rule). Otherwise P is a new fake package (typosquat, dependency-confusion placeholder, a package made to be malicious); those are reported apart as counts of versions and packages only, and are not judged.
- Ludion's smallest-fix logic could select V, in one of two ways:
  - direct: an OSV vulnerability record (not MAL-) for P has a `fixed` event equal to V in the same major (same minor for 0.x). The planner (packages/cli/src/security/osv.ts) takes the smallest such fixed event above the installed version.
  - transitive, moving in the diff: V is the highest non-prerelease version satisfying `^prev` among P's versions published up to V's publish time, where prev is P's latest legitimate version from the first condition. A candidate keeps every installed version but resolves a fixed version's new dependencies fresh (packages/cli/src/security/dependency-patch.ts), so a new dependency declared with that range would install V while V is the newest.
  Versions of packages the registry no longer serves cannot be placed; they are reported as unknown, outside the denominator.

**2. When the judge stops V.** For each urgency u, the wait w is the judge's (packages/cli/src/security/judge.ts): 12h exploited when provenance is comparable on both sides, else 24h; 24h high; 72h normal; 168h low; a publisher change or a new dependency extends w to max(2w, 72h). V is stopped when, at V's publish time + w, any of these holds:

- re-query: a MAL- record naming V is public. Primary timing is the first run's conservative one (the record's `modified` time when V may have been added to the record later); the optimistic one is also shown.
- provenance regression: prev had build provenance and V has none, or V names a different repository or workflow.
- install scripts added: V declares preinstall/install/postinstall that prev did not.
- publisher change and new dependencies: they do not stop by themselves; they extend the wait, and what they add is the versions the re-query catches only within the extended wait.
- deprecation: the registry keeps no deprecation time, so whether V was deprecated by then is unknown. Versions deprecated today are shown as an upper bound and are not counted as stopped.

The registry no longer has the scripts, dependencies, publisher or provenance of removed versions. In the primary count those signals do not fire for removed versions (unknown is not a stop). The first run's "provenance inferred" variant (a removed version that replaced one with provenance had none) is shown apart and not used for the gate. For each signal the result shows the versions where it fires and the versions stopped by it alone.

**3. Delay.** The same genuine-fix sample procedure as the first run (the first 200 by hash of the npm fixed versions in GHSA records published in 2025, the update from the highest earlier version of the same major), judged with the facts on the run date. Ludion's added delay = max(0, fix publish + w − advisory publish), with w the judge's wait for that update and the advisory's publish time from its OSV record. Stopped updates have no delay and are counted apart. Median and 90th percentile per urgency (exploited, high, normal, low), each with its n; an urgency with no updates in the sample is reported as not measured. The number of updates whose advisory was published before the fix is also shown, since the formula then also counts the time between the two.

**4. Gates.** All three must hold:

- every malicious version in the denominator is stopped, at each of the four urgencies' waits (primary count);
- the median added delay is within 24h for exploited and for high, each;
- the median added delay is within 72h for normal.

Low (dev-only) has no gate. Not measured counts as not met.

