# Judge backtest v3: the time cap (2026-10-28)

The owner's instruction after the rerun: keep the wait table, and cap the dependencies that move with a fix at the fix's publish time T. The rules are in docs/decisions.md, "Moving dependencies are capped at the fix's publish time" (implemented in #148). This run's definitions are in "Backtest v3: definitions fixed before running it", committed as bd0bc02 at 14:10 JST, pushed and merged (#147) before either script ran. The wait table is unchanged.

Data: the same OSV npm export as the rerun (`all.zip`, sha256 `8b3170a6…`, downloaded 2026-10-27). Registry packuments were read on 2026-10-28, and deps.dev was read the same day. Both scripts ran in Docker: node:24-slim, read-only root, non-root, no forwarded host environment, network only for the registry and deps.dev reads.

## Result: not met

| Gate (registered) | Result | |
| --- | --- | --- |
| Every malicious version in the denominator stopped, at each urgency's wait (missed or unknown counts as not stopped) | **not met** | 991 / 1,148 at 12h and 24h, 1,054 at 72h, 1,071 at 168h. Missed: 1 at every wait. Unknown: 156 / 156 / 93 / 76 |
| Exploited: median added delay within 24h | met | 16.4h (n = 5) |
| High: median added delay within 24h | met | 0h (n = 19) |
| Normal: median added delay within 72h | met | 41.5h (n = 127) |

All three must hold, so v3 does **not meet** the gate. Only one malicious version is actually missed. The rest of the shortfall is unknown: a fix inside that version's window has a dependency branch that can no longer be read.

## Malicious releases: `malicious-v3.json`

`node tools/backtest/src/malicious-v3.ts <osv-npm-dir> docs/bench/2026-10-28-backtest-rerun/malicious-v2.json <cache-dir> <out.json>`

Fixes: there are 5,851 non-prerelease npm fixed versions in GHSA records. Of these, 5,594 have a registry publish time. 257 are left out: 8 packages are no longer served, 2 could not be read, and 247 versions have no time. 5,398 fixes were published after at least one malicious version, and each had its production tree resolved as of its T (median 20 versions, max 2,771):

- 494 trees are stopped by rule 1 (a requirement nothing before T satisfies);
- 603 trees have an unreadable branch: a version the registry no longer serves (removed malicious versions among them), a package it does not serve, or a requirement that is not a registry range.

Outcome per malicious version (primary: missed if either lockfile scenario misses it), conservative record timing:

| Urgency (wait) | Stopped | Missed | Unknown | Optimistic timing: stopped / missed / unknown | Rerun (v2), stopped |
| --- | --- | --- | --- | --- | --- |
| Exploited (24h; 72h when P is new to the project) | 991 | 1 | 156 | 1,013 / 1 / 134 | 928 |
| High (24h; 72h new) | 991 | 1 | 156 | 1,013 / 1 / 134 | 928 |
| Normal (72h; 144h new) | 1,054 | 1 | 93 | 1,083 / 1 / 64 | 1,044 |
| Low (168h; 336h new) | 1,071 | 1 | 76 | 1,085 / 1 / 62 | 1,070 |

Per scenario, the conservative count is stopped / missed / unknown:

| Scenario | Exploited and high | Normal | Low |
| --- | --- | --- | --- |
| (a) P not in the lockfile | 1,054 / 1 / 93 | 1,069 / 1 / 78 | 1,071 / 1 / 76 |
| (b) P locked at prev | 991 / 1 / 156 | 1,054 / 1 / 93 | 1,071 / 1 / 76 |

(b) has more unknowns at the shorter waits because its wait is not extended: P is not new to the project.

### Malicious versions a later fix selects (listed individually)

Only 7 of the 1,148 are selected by any fix published after them, in either scenario. For the rest, no real fix's tree resolves to them.

| Malicious version | Published | Record after | Fixes selecting it: (a) / (b) | First such fix (hours after V) | Outcome, all four waits |
| --- | --- | --- | --- | --- | --- |
| @ensdomains/buffer 0.1.1 (MAL-2025-190866) | 2023-02-28 | 24,006.8h | 1 / 1 | @ensdomains/ens-contracts 0.0.22, GHSA-rrxv-q8m4-wch3 (3,158.3h) | **missed** |
| debug 4.4.2 | 2025-09-08 | 1.2h | 5 / 0 | prebid.js 10.10.0 (0.5h) | stopped (re-query) |
| color-name 2.0.1 | 2025-09-08 | 1.8h | 3 / 0 | color-string 2.1.2 (123.2h) | stopped (re-query) |
| is-arrayish 0.3.3 | 2025-09-08 | 2.0h | 1 / 0 | simple-swizzle 0.2.4 (123.1h) | stopped (re-query) |
| error-ex 1.3.3 | 2025-09-08 | 1.8h | 1 / 0 | flowise 3.0.6 (166.0h) | stopped (re-query) |
| simple-swizzle 0.2.3 | 2025-09-08 | 1.9h | 1 / 0 | @meshconnect/web-link-sdk 3.3.2 (50.8h) | stopped (re-query) |
| @asyncapi/specs 6.10.1 | 2025-11-24 | 8.4h | 2 / 0 | @orval/core 7.19.0 (1,403.7h) | stopped (re-query) |

Notes on the table:

- **The one miss.** @ensdomains/buffer 0.1.1 was published in 2023 and named by a MAL- record 2.7 years later. The registry has removed it and deps.dev does not have it, so nothing shows whether that version was malicious when published or why the record names it. By the registered definition it is missed.
- **The other six.** Their records were public before any selecting fix's wait ended.
- **Rule 1 stopped two further selections:** one of debug 4.4.2's in (a), and one of @asyncapi/specs 6.10.1's.
- **Removed versions are counted as installable.** The model treats them as available at T because their removal times are unknown. In reality the registry may already have refused to serve them.

### Gate 2 signals (registered: unverified is not filled in)

| Signal | Read from the registry | From deps.dev | Unverified | Fires |
| --- | --- | --- | --- | --- |
| Provenance regression | 8 | 0 | 1,140 | 0 |
| New dependencies | 8 | 0 | 1,140 | 0 |
| Install scripts added | 8 | 0 | 1,140 | 1 |
| Publisher change | 8 | 0 | 1,140 | 2 |

deps.dev was queried for all 1,140 removed versions and their predecessors. It has none of the removed malicious versions; it has 1,016 of their predecessors. So nothing about the removed versions could be compared, and those signals are unverified for 1,140 versions.

Rule 2 cannot fire on P in this denominator: every P had a legitimate version at least 7 days before V. The script checks this (`rule2_could_fire_on_p`: 0). "First publish" is the earliest of `time.created` and every version's time, because a re-created package gets a new `created`.

## Genuine fixes: `fixes-v3.json`

`node tools/backtest/src/fixes-v3.ts <osv-npm-dir> <cache-dir> <out.json> 200`. The sample is the rerun's: the first 200 by hash, with the same skips. It is judged with rules 1 and 2. Added delay = max(0, fix publish + w − advisory publish).

| Urgency | Updates | Stopped | Added delay n | Median | 90th percentile | Rerun (v2): stopped, median |
| --- | --- | --- | --- | --- | --- | --- |
| Exploited | 8 | 3 | 5 | 16.4h | 75.4h | 2, 16.4h |
| High | 34 | 15 | 19 | 0h | 71.4h | 13, 0h |
| Normal | 158 | 31 | 127 | 41.5h | 91.9h | 20, 41.5h |
| Low | 0 | 0 | 0 | not measured | not measured | — |

Stops: 49 of 200 (rerun: 35).

- **Rule 1 stops 29, and is the only reason for 14.** These are almost all monorepo releases whose sibling packages, pinned to the same version, were published after the fixed package (for next, 5 to 11 seconds after), so nothing before T satisfies them:
  - next and `@next/env` (18 updates);
  - n8n and its `@n8n/*` packages;
  - directus;
  - @intlify, @apollo/composition, @vitest/browser and astro.
- This count is an upper bound. The tree is resolved with no lockfile, and npm usually publishes the siblings in the same release run. But the registered rule (strictly before T, and nothing published at or after T unless already locked) stops them.
- **Rule 2 stops none.**
- 23 of the 200 trees have an unreadable branch.

The delay medians are unchanged from the rerun because the added stops are counted apart. The delay gates are met.

## Reading

- The time cap does what the owner asked on the malicious side. 7 of the 1,148 removed malicious versions are ever selected by a real fix's resolution as of its T. Six of those were caught by the re-query before any selecting fix's wait ended.
- The gate still fails. One version is missed, a 2023 version named by a 2025 record, and 76 to 156 versions are unknown because a fix in their window resolves through a branch the registry no longer serves. The registered gate counts unknown as not stopped.
- Rule 1 costs genuine fixes. Monorepos that publish a fixed package before its same-version siblings are stopped: 29 of 200 here, 14 of them for no other reason. Rule 1 says "strictly before T", so these stops follow from the rule as registered. Changing that (for example, a few minutes of tolerance for packages released together) would be a new decision and a new run.
- The wait table is not changed.

## Script bug found before the results were written up

The first execution of both scripts resolved requirements only among versions the registry still lists. That made the removed malicious versions unselectable: 0 of 1,148 were selected, which was implausible, and the summary showed 1,103 stopped and 45 unknown at 24h. The registered definition says "published before T", which includes versions removed later. The scripts were corrected to choose among every version with a publish time (`Object.keys(time)`) and run again. The numbers above are from the corrected run. The fixes run gave the same figures before and after the correction. The definitions were not changed.
