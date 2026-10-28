## 2026-10-28 — Backtest v3: definitions fixed before running it

Committed before the run and not changed after seeing results; a later change is a new entry with a new run. The wait table is unchanged. The data is the same OSV npm export as the rerun (`all.zip`, sha256 `8b3170a6…`, downloaded 2026-10-27), plus registry packuments and deps.dev, read on the run date.

**1. Denominator.** The rerun's 1,148 malicious versions (`docs/bench/2026-10-28-backtest-rerun/malicious-v2.json`, `rows`): for each, its package P, version V, publish time p, prev, and record times (conservative primary, optimistic shown).

**2. Fixes.** Every non-prerelease npm `fixed` event of non-withdrawn GHSA- records in the same export, published in any year. For each fixed version A@x, T is its registry publish time. Fixed versions the registry does not list, or that have no publish time, are counted and left out.

**3. Ludion's resolution with rule 1, reproduced.** A@x's production tree as of T. Each requirement resolves to the highest non-prerelease version published before T that satisfies its range. Requirements are `dependencies`, `optionalDependencies`, and `peerDependencies` not marked optional. Bundled names are skipped, and an `npm:` alias resolves to the package it names. Each name@version is expanded once per tree. If no version published before T satisfies a requirement, rule 1 stops that update. For P there are two scenarios:

- (a) P is not in the lockfile, so its requirement resolves as above;
- (b) P is locked at prev. A requirement that prev satisfies keeps prev; any other resolves as above.

A@x selects V when some requirement on P in its tree resolves to V and rule 1 does not stop the tree. A branch through a package the registry does not serve, or whose document cannot be read, is unknown.

**4. When the judge stops a selected V.** The change carrying A@x and P@V is judged when its wait ends, at T + w. The judge's own `wait` sets w: in (a) P is new to the project, so w extends to max(2w, 72h); in (b) extensions come from V against prev, as in the rerun. V is stopped when any of these holds:

- re-query: the record is public by T + w;
- provenance regression (in (b) only, since (a) has no predecessor): read from the registry, else from deps.dev (`slsaProvenances`, `attestations`) for both V and prev;
- install scripts added: read from the registry only, so unverified for removed versions;
- rule 2.

Rule 2 is computed, but it cannot fire on P, which has a legitimate version at least 7 days before V while w ≤ 168h. New dependencies for the (b) extension come from the registry, else deps.dev `:requirements`. Each gate 2 signal reports how many versions it was read from the registry for, how many from deps.dev, and how many are unverified. Unverified versions are not counted as stopped by that signal, and no number fills them in. The advisory's publish time is not used, since it could only delay the application.

**5. Outcome per V, per urgency u (the four waits), per scenario.** The outcomes are:

- missed: some A@x selects V and is not stopped;
- unknown: none is missed, but a fix with T in (p, record − w) has an unknown branch;
- stopped: neither applies, including when no fix in that window selects V.

The primary result counts V as missed if either scenario misses it, and unknown if either scenario is unknown and neither misses it. All V for which some A@x with T > p selects them in either scenario are listed individually: the scenario, the number of such fixes, the earliest fix and its T, and the outcome per urgency.

**6. Delay.** The rerun's sample (the first 200 by hash), formula (added delay = max(0, fix publish + w − advisory publish)) and per-urgency median and 90th percentile, judged with rules 1 and 2:

- rule 1: A@x's tree resolved as of T as in section 3, with no lockfile. A requirement that nothing before T satisfies stops the update. This is an upper bound, since a real lockfile can already hold a later version.
- rule 2: A@x's dependencies that A@from did not declare.

Stopped updates have no delay and are counted apart.

**7. Gates.** These are the rerun's gates, with the primary count. Every malicious version is stopped at each of the four urgencies, and missed or unknown counts as not stopped. The median added delay is within 24h for exploited and for high, and within 72h for normal. Not measured counts as not met.

