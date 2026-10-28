# Judge backtest v4: rule 1's same-release exception (2026-10-28)

The owner's instruction after v3's genuine-fix results: add an exception to rule 1 for siblings of the same release, before looking at the malicious results, and run both sides with the same rules. The rule and this run's definitions are in docs/decisions.md, "Rule 1's same-release exception, and backtest v4's definitions". The implementation is #151 (`sameRelease` in `packages/cli/src/security/time-cap.ts`, with the facts it reads in `npm-facts.ts`, `judge.ts` and `dependency-patch.ts`). The wait table is unchanged.

## When things were fixed, and what had been seen

| What | Commit | Time (JST) |
| --- | --- | --- |
| The exception and v4's definitions | e995557 (#150) | 2026-10-28 15:04:14 |
| Amendment after review round 1 of #151 (stricter) | 08aa452 (#151) | 15:24:46 |
| Amendment after review round 2 (stricter) | 17b55b7 (#151) | 15:34:18 |
| Wording of the publisher-name rule (docs only) | f78c931 (#151) | 15:36:07 |
| The v4 scripts | 5ef3a5f | 15:36:20 |
| **First execution** (the result) | at 5ef3a5f | 15:37:05–15:48:33 |
| Diagnostic field (changes no outcome) | baafc36 | 15:50:21 |
| Diagnostic execution | at baafc36 | 15:50:32–15:52:04 |

All four definition commits (e995557, 08aa452, 17b55b7 and f78c931) were pushed before either script ran; f78c931's CI started at 15:36:11. The amendments only made the exception stricter. (Corrected 2026-10-28, cycle 2: this sentence said "three" and the first one named only `time-cap.ts`.)

Disclosure: v3's malicious run had already finished (committed 14:50 JST, summarised in #149's description) when the owner's task was written at 14:53. This session read #149's description before writing the definitions: 7 of 1,148 versions selected, 1 missed, 156 unknown at 24h. It did not read v3's per-version malicious results until the definitions were committed. The exception's terms are the owner's. The details chosen here are listed in the decisions entry.

## Data and how it ran

- **OSV:** the same npm export as the rerun and v3 (`all.zip`, sha256 `8b3170a6…`, downloaded 2026-10-27).
- **Registry and deps.dev:** v3's cache (read 2026-10-28) was reused. Everything it lacked was read on 2026-10-28: publishers, attestations, new packages.
- **Two smoke runs:** before the run, the smoke runs had written publisher and attestation entries under an earlier draft of the publisher rule. Those caches were deleted before the first execution, so every publisher and provenance fact in the result was read by the committed code.
- **Isolation:** both scripts ran in Docker (node:24-slim) with a read-only root, as a non-root user, with no forwarded host environment. The network was used only for the registry and deps.dev reads.
- **Two malicious executions:**
  - The first, at 5ef3a5f, is the result: `malicious-v4.json`.
  - The diagnostic one, at baafc36, only added the list of fixes that make a version unknown. Apart from that field and the time, its output equals the first execution's (checked).
  - `malicious-v4-unknown.json` is the extract of that field.
  - `run-times.txt` has both executions' times (UTC).

Every result is computed twice on the same data: with the exception (primary, used for the gates) and without it. Without it is v3's rule, and it reproduces v3's numbers exactly on both sides.

## Result: not met

| Gate (registered) | With the exception | Without (v3's rule, same data) |
| --- | --- | --- |
| Every malicious version stopped at each wait (missed or unknown counts as not stopped) | **not met**: 990 / 1,148 at 12h and 24h, 1,052 at 72h, 1,071 at 168h. Missed 1 at every wait. Unknown 157 / 157 / 95 / 76 | not met: 991, 1,054, 1,071. Missed 1. Unknown 156 / 156 / 93 / 76 |
| Exploited: median added delay ≤ 24h | met: 16.4h (n = 6) | met: 16.4h (n = 5) |
| High: median added delay ≤ 24h | met: 0h (n = 21) | met: 0h (n = 19) |
| Normal: median added delay ≤ 72h | met: 41.5h (n = 138) | met: 41.5h (n = 127) |

All four must hold, so v4 does **not meet** the gate.

The exception removes all of rule 1's stops on the 200 genuine fixes. It lets no malicious version in, either as a sibling or through a tree it unblocks. On the malicious side it moves one version from stopped to unknown at 24h, and two at 72h.

## Genuine fixes: `fixes-v4.json`

`node tools/backtest/src/fixes-v4.ts <osv-npm-dir> <cache-dir> <out.json> 200`. The sample is the rerun's and v3's: the first 200 by hash, with the same skips. Added delay = max(0, newest + w − advisory publish), where newest is the latest of T and the publish times of the versions the exception allowed.

| Urgency | Updates | With: stopped | With: delay n, median, p90 | Without: stopped | Without: delay n, median, p90 |
| --- | --- | --- | --- | --- | --- |
| Exploited | 8 | 2 | 6, 16.4h, 75.4h | 3 | 5, 16.4h, 75.4h |
| High | 34 | 13 | 21, 0h, 40.9h | 15 | 19, 0h, 71.4h |
| Normal | 158 | 20 | 138, 41.5h, 91.3h | 31 | 127, 41.5h, 91.9h |
| Low | 0 | 0 | not measured | 0 | not measured |

Stops: 35 of 200 with the exception, 49 without.

Stops per signal. "Fires" is the number of updates the signal stops; "alone" is the number it stops with no other signal:

| Signal | With: fires / alone | Without: fires / alone |
| --- | --- | --- |
| Rule 1 (the tree, as of T) | 0 / 0 | 29 / 14 |
| Deprecation (today's registry) | 30 / 20 | 30 / 11 |
| Gate 1: advisories the old version did not have | 12 / 2 | 12 / 2 |
| Install scripts added | 1 / 1 | 1 / 1 |
| Provenance regression | 1 / 1 | 1 / 1 |
| No longer listed | 1 / 1 | 1 / 1 |
| Rule 2 | 0 | 0 |

What the exception did:

- **It allowed 69 versions in 30 updates.** 29 updates were allowed through the provenance branch (the same repository, workflow and commit). One, @apollo/composition 2.12.1, was allowed through the publisher branch: @apollo/query-graphs and @apollo/federation-internals 2.12.1, 0.4 s after the fix, with no provenance. The latest allowed sibling came 127 s after its fix (n8n).
- **The families:**
  - next: 18 updates;
  - directus and @directus/api: 4;
  - n8n: 3;
  - @intlify/core, @apollo/composition, @vitest/browser, astro and @astrojs/node: 1 each.
- **Rule 1 would have stopped 29 of these 30 without it.** In the 30th, @astrojs/node 9.4.1, the exception only chose a newer sibling than the before-T version, and its verdict did not change.
- **14 updates go from stop to ready (except build):**
  - n8n 1.114.0, 1.119.2 and 1.121.1;
  - @intlify/core 9.14.5;
  - directus 11.5.0 and 11.13.0;
  - @directus/api 24.0.1 and 28.0.2;
  - next 15.0.7, 15.4.10 and 16.0.10;
  - @apollo/composition 2.12.1;
  - @vitest/browser 3.0.4;
  - astro 5.12.8.
- **The other 15 rule-1 stops are next releases, still stopped by today's deprecation**, some also by gate 1's new advisories.
- **No update is stopped by rule 1 with the exception.** 23 trees have a branch that cannot be read, the same as without.

## Malicious releases: `malicious-v4.json`

`node tools/backtest/src/malicious-v4.ts <osv-npm-dir> docs/bench/2026-10-28-backtest-rerun/malicious-v2.json <cache-dir> <out.json>`. The denominator is the rerun's 1,148 versions. The fixes are v3's: 5,851 npm fixed versions in GHSA records, 5,594 with a registry time.

5,399 fixes were published after (some malicious version's publish − 24h), the 24h being the exception's search horizon. Each had its tree resolved both ways:

| | With the exception | Without |
| --- | --- | --- |
| Trees stopped by rule 1 | 43 | 494 |
| Trees with a branch that cannot be read | 610 | 603 |
| Tree size (versions), median / max | 21 / 2,771 | 20 / 2,771 |

- **What the exception allowed:** versions in 521 trees, 992 distinct versions through the provenance branch and 439 through the publisher branch. It unblocked 451 trees that rule 1 stopped.
- **Unverified checks:** 3 trees have a same-release check that could not be verified. Each such candidate was a version the registry no longer lists, or one whose facts could not be read. None of them is a malicious version. Each counts as an unknown branch.

Outcome per malicious version, conservative record timing, primary result (missed if either lockfile scenario misses it):

| Urgency (wait) | With: stopped / missed / unknown | Optimistic timing | Without: stopped / missed / unknown |
| --- | --- | --- | --- |
| Exploited (24h; 72h when P is new) | 990 / 1 / 157 | 1,012 / 1 / 135 | 991 / 1 / 156 |
| High (24h; 72h new) | 990 / 1 / 157 | 1,012 / 1 / 135 | 991 / 1 / 156 |
| Normal (72h; 144h new) | 1,052 / 1 / 95 | 1,082 / 1 / 65 | 1,054 / 1 / 93 |
| Low (168h; 336h new) | 1,071 / 1 / 76 | 1,085 / 1 / 62 | 1,071 / 1 / 76 |

Per scenario with the exception, conservative, stopped / missed / unknown:
- (a) P not in the lockfile: 1,052 / 1 / 95 at 12h and 24h, 1,068 / 1 / 79 at 72h, 1,071 / 1 / 76 at 168h;
- (b) P locked at prev: the same as the primary result.

Why stopped versions are stopped, with the exception. Without it the counts are the same, plus the one or two versions the exception changes:

| Reason | 12h / 24h | 72h | 168h |
| --- | --- | --- | --- |
| No fix (that rule 1 lets through) selects it | 984 (alone 983) | 1,046 (alone 1,045) | 1,065 (alone 1,064) |
| Selected, and the re-query finds the record before every selecting fix's wait ends | 6 (alone 6) | 6 (6) | 6 (6) |
| Install scripts on a new package (registry) | 1 (alone 0) | 1 (0) | 1 (0) |
| Provenance regression | 0 | 0 | 0 |
| Selected only in trees that rule 1 stops | 0 | 0 | 0 |
| Rule 2 | 0: cannot fire on P (every P had a legitimate version at least 7 days before V) | | |

### Malicious versions the exception allowed (listed individually)

**None.** No malicious version was allowed as the same release as any fix. No malicious version is selected with the exception that is not also selected without it. No same-release check on a malicious version was unverified.

### Malicious versions published before T of a fix that selects them (listed individually)

These are the same 7 as v3. Outcomes are with the exception, at all four waits.

| Malicious version | Published | Record after | Fixes selecting it, with / without the exception: (a) + (b) | First such fix (hours after V) | Outcome |
| --- | --- | --- | --- | --- | --- |
| @ensdomains/buffer 0.1.1 (MAL-2025-190866) | 2023-02-28 | 24,006.8h | 1+1 / 1+1 | @ensdomains/ens-contracts 0.0.22, GHSA-rrxv-q8m4-wch3 (3,158.3h) | **missed** |
| debug 4.4.2 (MAL-2025-46974) | 2025-09-08 | 1.2h | 6+0 / 5+0 | prebid.js 10.10.0, GHSA-jwq7-6j4r-2f92 (0.5h) | stopped (re-query) |
| color-name 2.0.1 (MAL-2025-46972) | 2025-09-08 | 1.8h | 3+0 / 3+0 | color-string 2.1.2, GHSA-286p-vc9p-p5qv (123.2h) | stopped (re-query) |
| is-arrayish 0.3.3 (MAL-2025-46977) | 2025-09-08 | 2.0h | 1+0 / 1+0 | simple-swizzle 0.2.4, GHSA-9g9j-rggx-7fmg (123.1h) | stopped (re-query) |
| error-ex 1.3.3 (MAL-2025-46975) | 2025-09-08 | 1.8h | 1+0 / 1+0 | flowise 3.0.6, GHSA-3gcm-f6qx-ff7p (166.0h) | stopped (re-query) |
| simple-swizzle 0.2.3 (MAL-2025-46978) | 2025-09-08 | 1.9h | 1+0 / 1+0 | @meshconnect/web-link-sdk 3.3.2, GHSA-vh3f-qppr-j97f (50.8h) | stopped (re-query) |
| @asyncapi/specs 6.10.1 (MAL-2025-190643) | 2025-11-24 | 8.4h | 3+0 / 2+0 | @orval/mcp 7.18.0, GHSA-mwr6-3gp8-9jmj (1,139.1h) | stopped (re-query) |

- **Two extra selecting trees.** The exception adds one for debug 4.4.2 and one for @asyncapi/specs 6.10.1. These are the two selections rule 1 stopped in v3. Both versions are still caught by the re-query.
- **The miss.** @ensdomains/buffer 0.1.1 is missed with and without the exception: a 2023 version named by a 2025 record. The registry has removed it and deps.dev does not have it, so nothing shows whether it was malicious when published.

### Malicious versions stopped only without the exception (listed individually)

Neither of these is selected by any fix in either run.

| Malicious version | Published | Record after | With the exception | Without | Why |
| --- | --- | --- | --- | --- | --- |
| loliloli 1.0.108 (MAL-2025-190629) | 2025-11-07 | 402.2h | unknown at 12h, 24h, 72h; stopped at 168h | stopped at every wait | The exception unblocks 5 fixes in its window at 24h (3 at 72h): n8n 1.119.2, 1.120.3, 1.121.0, and others. Rule 1 stopped all of them without it. Each now resolves and has a branch that cannot be read |
| @alexcolls/nuxt-ux 0.6.2 (MAL-2025-191186) | 2025-11-24 | 161.0h | unknown at 12h, 24h, 72h; stopped at 168h | unknown at 12h and 24h; stopped at 72h and 168h | At 72h, n8n 1.121.3 (unblocked by the exception) resolves with a branch that cannot be read |

That is 1 version at 12h and 24h, 2 at 72h, and 0 at 168h. Both become **unknown, not missed**. The registered rule (v3, section 5) counts any fix in a version's window whose tree has a branch that cannot be read as unknown, whether or not the version could be in that branch.

Of the 157 unknown versions at 24h, 74 have at least one such fix among the trees the exception unblocked. All of those except loliloli 1.0.108 were unknown without the exception too. `malicious-v4-unknown.json` lists the fixes per version.

### Gate 2 signals (unverified is not filled in)

| Signal | Read from the registry | From deps.dev | Unverified | Fires |
| --- | --- | --- | --- | --- |
| Provenance regression | 8 | 0 | 1,140 | 0 |
| New dependencies | 8 | 0 | 1,140 | 0 |
| Install scripts added | 8 | 0 | 1,140 | 1 |
| Publisher change | 8 | 0 | 1,140 | 2 |

As in v3, deps.dev has none of the 1,140 removed malicious versions. So these signals are **unverified** for 1,140 of the 1,148, and none is counted as a stop.

The exception's own facts (publisher, provenance) were read from the registry for every version it considered. A version the registry no longer lists has neither fact, so its check is unverified, never allowed. That happened in 3 trees, for versions that are not in the denominator.

## Reading

- **The genuine-side cost of rule 1 is gone.** All 29 rule-1 stops become allowed siblings, 28 of them through provenance with the same repository, workflow and commit. 14 updates become ready (except build); 15 next releases stay stopped by today's deprecation. The delay gates are met with and without the exception. The medians are unchanged, and each sibling adds at most about two minutes to its update's wait.
- **On the malicious side, the exception lets nothing in.** No malicious version is a same-release sibling of any fix. None is selected only because a tree was unblocked. The two versions it moves to unknown are not selected by any fix. They are unknown because 451 unblocked trees now count under the registered unknown rule, and n8n's large trees have branches the registry no longer serves.
- **The gate is still not met, for the same reasons as v3:**
  - one version is missed, @ensdomains/buffer 0.1.1, published in 2023 and named in 2025;
  - 76 to 157 versions are unknown because some fix in their window resolves through a branch that cannot be read.
- **Limits of this run:**
  - The exception's search stops at T + 24h. In the product, the provenance branch has no time limit.
  - Removed versions are counted as installable at the time.
  - Gate 2's provenance, scripts and publisher are unverified for 1,140 of the 1,148 removed versions.
  - A publisher whose account was hijacked, and who publishes a sibling with the fix's version number within 15 minutes and without provenance, would pass the exception. No such case occurs in this data; the wait and the re-query still apply to it.
- The wait table is not changed.
