# LC3: backtest v4's 200 fixes on main's judge, and the next candidate (2026-11-01)

**The brief's count is not reached.** main's judge stops 44 of the 200, not 35. Drawing the next candidate lets 8 of those 44 pass, against the 31 the brief asked about, or the 40 that 4 of 200 now needs. 36 stay stopped; C3's line needs 4 or fewer.

Definitions: docs/decisions/2026-11-01-lc3-definitions.md, committed and pushed at 7282aa8 before anything was judged, and not changed since. The script is `measure.mjs` at d26f8d9. No code of the gates or the plan changes here, and no row of the wait table.

"Passes" means gates 1, 2 and 4 as the judge has them, and the time cap. **Gate 3 is not run:** nothing is downloaded or run, so a version that passes here may still break.

## Files

- `lc3-rows.json`: every row and the whole summary. Its deprecation messages and stop reasons are third-party text, kept as data.
- `tables.md`: per-row tables, written by `table.mjs` from `lc3-rows.json`.
- `run-times.txt`: the times, and the memory peak of each run.
- `measure.mjs`, `run.sh`: what ran.

## How it ran

| What | Value |
| --- | --- |
| Commit | d26f8d97f4cdab734e31bb414b43f9791c0440b6 (main 4aefb22 plus only the definitions and this script) |
| Time (UTC) | 2026-11-01 12:25:01 to 12:36:37, exit 0, one complete run |
| Image | node:24@sha256:e7add2a4… (v24.22.2) |
| Container | no credentials, no forwarded host environment, read-only root, non-root user, no capabilities, 4 GiB limit |
| Requests | 7,598, none retried, none failed |
| EPSS list's score date | 2026-10-31T12:00:27Z |
| Hosts | registry.npmjs.org, api.osv.dev, and the judge's whole-list downloads from cisa.gov and epss.empiricalsecurity.com |
| memory.peak | 4,294,967,296 bytes, which is the limit. It counts page cache as well as the process, and how much was which is not known. The process exited 0 with all 200 rows |

**A smoke run** read the first 3 rows (react-server-dom-turbopack@19.2.2, axios@1.8.2, @react-native-community/cli-server-api@19.1.2) at 12:23:59 to 12:24:36. Its cache and output were deleted before the run above, and nothing was changed after it.

## 1. Stops on main: 44 of 200 (22%), v4 35 (17.5%)

All 44 are verdict `stop`; none is `undecidable`.

| Signal | main: fires / alone | v4: fires / alone |
| --- | --- | --- |
| Deprecation | 30 / 19 | 30 / 20 |
| Gate 1: new advisories | 15 / 4 | 12 / 2 |
| Provenance: event (new since v4) | 7 / 4 | not in v4 |
| Rule 1 (tree) | 3 / 0 | 0 / 0 |
| Install scripts | 1 / 1 | 1 / 1 |
| Provenance | 1 / 1 | 1 / 1 |
| Withdrawn | 1 / 0 | 1 / 1 |
| Gate 4 (v4 left it out) | 1 / 0 | not counted |

Trees with a branch that cannot be read: 23, as in v4; not counted as stops.

**The 9 rows that moved from ready to stop:**

- **7 by a code change**, gate 2's event rule from docs/decisions/2026-10-30-provenance-immutable-id.md. Each statement records a GitHub `pull_request` event: axios@1.8.2, @auth0/nextjs-auth0@4.5.1, get-jwks@11.0.2, n8n@1.107.0, n8n@1.114.0, n8n@1.119.2 and n8n@1.121.1. In the last three the same rule also refuses the same-release exception for n8n's siblings, which is rule 1's 3.
- **2 by a new record, not by code:** @intlify/core@9.14.5 and @intlify/vue-i18n-core@9.14.5, for GHSA-83rm-6c8r-g728, which OSV published on 2026-10-28 at 21:06 UTC, after v4's run that day.

**2 more rows changed signals and stayed stopped:** vue-i18n@9.14.5 gained that record, and taylored@7.0.8, which the registry no longer lists, has no integrity, so gate 4 fires beside its withdrawal. No row went from stop to ready. Urgency changed for none.

## 2. The two kinds of deprecation: a range

The registry keeps no date for a deprecation, so the split is a range. K, L and U are the definitions' section 3; the moment is T + w.

| Rows | K (known at the cutoff) | L (written later, by its text) | U (no evidence) | Known at the cutoff | Only in today's registry | Widest, known at the cutoff |
| --- | --- | --- | --- | --- | --- | --- |
| All 30 | 0 | 7 | 23 | 0 to 23 | 7 to 30 | 0 to 30 |
| The 19 stopped by it alone | 0 | 7 | 12 | 0 to 12 | 7 to 19 | 0 to 19 |

- No package's `time.modified` is at or before its cutoff, so K is 0 throughout.
- All 7 L rows are next releases whose message links to an update dated 2025-12-11, after their cutoff.
- A message can be rewritten, so L is evidence and not proof. That is why the widest range is given.
- Four U rows (next 15.2.2, 15.2.3, 15.2.4 and 15.3.3) have messages naming CVE-2025-66478. OSV returned no record with that id or alias for their `from` or `to`, so the fixed rule leaves them in U. They are not moved.

**What it does to the count, with no new candidate:** if no deprecation was known at the cutoff, the stops are 25. If only the 7 L rows are taken out, they are 37. As written, today's registry, they are 44.

## 3. The next candidate: 8 pass, the answer to the brief

| Reading | Stopped before drawing | Pass with no draw | Candidates | Candidates that pass | Final stopped of 200 | At most 4? |
| --- | --- | --- | --- | --- | --- | --- |
| **A, today's registry and OSV: the answer** | 44 | 0 | 11 | **8** | **36** | no |
| B, a deprecation counts only with K (the range's upper side) | 25 | 19 | 12 | 9 | 16 | no |
| C, B and an advisory counts only if published by the cutoff (added, not asked for) | 19 | 25 | 13 | 9 | 10 | no |

**Against the brief's numbers:**

- Reading A: 8 of 44 pass; 31 was asked about, for N = 35, and with N = 44 the number that reaches 4 of 200 is 40.
- Reading C has 34 rows that stop being stopped (25 with no draw and 9 by a candidate), which is above 31. It still leaves 10 stopped, since N is 44, so the line is not reached there either.
- B and C are not the registry as it was. They are today's facts with some removed.

**Reading A's funnel over the 44:**

| Step | Rows |
| --- | --- |
| No later version of the major published by the cutoff | 20 |
| Every version published by the cutoff was passed over | 13 |
| A candidate found | 11 |
| Its publisher check passes | 8 |
| It passes the gates | 8 |
| **Passes** | **8** |

- **Passed over:** 131 versions for a deprecation, 4 not listed, 1 for a new advisory.
- **The 3 candidates that fail** are all n8n (1.107.1, 1.114.1, 1.120.0). Each has the same `pull_request` event as the version it would replace, and fails the publisher check as well as the gates, so the count is 8 with or without that check.
- **The 8 that pass:** next 16.0.10, 15.5.9, 15.2.8, 15.1.11, 15.0.7 and 13.5.11, form-data 2.5.5 and formidable 3.5.4. Six of the eight are one package, and five of those six come from releases published within about 25 minutes on 2025-12-11, so they are not independent of each other.

**What stays stopped in reading C (10 rows):** 7 by the event rule (the 7 listed in section 1), then taylored@7.0.8 (withdrawn), @auth0/nextjs-auth0@4.11.2 (provenance lost) and duckdb@1.3.4 (install scripts).

**The hypothesis.** The brain's hypothesis was that most stops are 「その版が悪いだけで、同じメジャーの次の版は通る」. In these data it does not hold in reading A: 33 of 44 have no candidate at all, 20 of them because no later version of the major existed by the cutoff, and 13 because every one that did was passed over. For 11 of the 13, today's registry deprecates every one. The other 2 have other reasons: taylored@7.0.8's 4 later versions are not listed, and of @auth0/nextjs-auth0@4.11.2's 2, 4.12.0 is deprecated and 4.12.1 has a new advisory (GHSA-xq8m-7c5p-c2r6).

**Beside the count: main's plan today (next-fix.ts).**

- Of the 8 that pass, 1 (formidable 3.5.4) is inside next-fix.ts's limits. The other 7 are named by an OSV record, not a new one, and next-fix.ts passes over any record. So main would not take them as it stands.
- Asked directly, main's `nextFix` on the 44: chooses a version for 7, and 1 of those was published by the cutoff. For 2 the smallest stays usable. For 35 it chooses none, 11 of them stopped by its publisher check. The judge was not run on these.

## 4. Delay, for C7: not a C7 judgement

v4's formula, added delay = max(0, newest + w − advisory publish); n is the rows that pass. It counts from the advisory's publication, as v4 did.

| Urgency | Rows | main, no draw: n, median, p90 | Reading A with candidates: n, median, p90 |
| --- | --- | --- | --- |
| Exploited | 8 | 5, 16.4h, 75.4h | 5, 16.4h, 75.4h |
| High | 34 | 19, 0h, 40.9h | 20, 0h, 40.9h |
| Normal | 158 | 132, 41.5h, 91.3h | 139, 43.9h, 91.3h |
| Low | 0 | not measured | not measured |

Rows with a wait-extending finding: 26 of 200, both ways.

## 5. Limits

- **The malicious side is not measured.** The brief counts a re-draw as loosening for C2's clock, since it can apply a version that would not have been applied. How many malicious versions a re-draw could select is unknown.
- **Gate 3 is not run**, and gate 1's OS, SAPI and configuration conditions are not matched.
- **Rule 1 with no lockfile** is an upper bound on its stops, as in v4.
- **Today's facts:** deprecation, provenance, publisher, KEV, EPSS and OSV are as of the run. A deprecation lifted since, or a record changed since, is not seen.
- **Drawing only at the cutoff:** the definition draws once, at T + w. What a later draw would find, a fix that stops and retries, say, is not measured.
- **The sample** is not independent: 16 of the 44 are next, 8 are react-server-dom-*, 4 are n8n.
