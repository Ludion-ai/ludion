下書き。送らない、公開しない。

# Article outline: "How a backtest found an error in GitHub's malware database"

**Status: 下書き・非公開 (draft, not public).** Outline only, not the article. **Whether to publish is the owner's decision, made after github/advisory-database Issue #10743 is resolved.** Nothing goes out before then.

Prepared around 2026-10-28 23:20 JST. Every number is copied from docs/bench/2026-10-28-backtest-v5/ (main `51a8f0b`).

## Title candidates

1. How a backtest found an error in GitHub's malware database (working title, as given)
2. We chased our one miss, and the database was wrong: a backtest over 1,148 malicious npm versions
3. Questioning the ground truth: checking @ensdomains/buffer 0.1.1 with Software Heritage and jsDelivr
4. The one version we failed to stop was a 2023 release (do not use before the Issue is resolved: it states the conclusion as fact)

## Sections

### 1. Introduction
- What Ludion does (judges whether to stop or delay a dependency update), in 2-3 lines.
- What the backtest is: replaying npm versions later recorded as malicious, using only what was knowable then.
- The point: tracing our single miss led to a likely error in the label data itself.

### 2. The backtest (v5)
- Denominator: **1,148** versions named malicious (OSV npm export, MAL- records).
- Four waits (12h / 24h / 72h / 168h); outcomes stopped / missed / unknown.
- Definitions committed before the run (definitions.md at 23ab295, 20:42:52 JST); "the first execution is the result".
- New sources: ecosyste.ms (copies of version documents) and Software Heritage (archived tarballs).

### 3. Results: the gate is not met, one miss
- Primary (conservative timing, with the exception): 12h and 24h 1,039 / 1 / 108; 72h 1,065 / 1 / 82; 168h 1,078 / 1 / 69 (stopped / missed / unknown).
- Stop-rate interval: 12h and 24h 90.51%–99.91%; 72h 92.77%–99.91%; 168h 93.90%–99.91% (lower bound counts every unknown as missed).
- v4 reproduced: 0 differences.
- Say plainly: the "every malicious version stopped" gate is **not met**; 108 / 82 / 69 remain unknown.

### 4. The one miss: @ensdomains/buffer 0.1.1
- GHSA-f9pq-63hg-w434 (imported into OSV as MAL-2025-190866) lists 0.1.1 and 0.1.2.
- Registry time: 0.1.1 2023-02-28T09:46:00.601Z; 0.1.2 2025-11-24T05:49:00.347Z.
- The registry no longer serves it, so archives:
  - Software Heritage (visit of 2023-03-23, `swh:1:dir:3d9e48db08c991644ad0eba0475ca1fbd9ecc047`) and jsDelivr hold the same 21 files with the same sha256.
  - SWH's original artifact: sha1 `6c275ba7e457e935405b67876f1f0d980c8baa63`, 284,259 bytes, equal to the registry's shasum.
  - Every `.js` and `.sol` file equals 0.1.0's; no install script.
  - The malicious content (`setup_bun.js`, `bun_environment.js`, `preinstall`) is only in 0.1.2.
- Of OSV's three origins, only ghsa-malware names 0.1.1.

### 5. The "disputed" category, and its limits
- Definition (quote): "A version named malicious for which the registry's hash and two independent archives (Software Heritage and jsDelivr, tied to that hash) show that its code equals the immediately preceding legitimate version's."
- Disputed versions stay in the denominator; the gate's numbers do not change.
- State that **the category was decided after seeing v4's results** (the README and definitions.md say so).
- Funnel: prev_d not listed 124, jsDelivr does not hold V 12, package.json check failed 988 (CDN 404), code differs 22, disputed 2; total 1,148.
- The 988 were blocked, not decided (the CDN does not serve removed versions' files).

### 6. The other disputed version: freo-design-system 1.0.4 (the lesson)
- It meets every criterion (re-checked 2026-10-28), yet its code really does send the username and hostname to an outside domain.
- It is disputed because the preceding 1.0.3 (identical code, with a preinstall) is not in MAL-2025-3399.
- Lesson: "identical to the preceding version" can point to a false positive or to a gap in the record; only the content tells which.
- Ludion stops 1.0.4 at every wait.
- (Whether an addition request went to ossf/malicious-packages: write what is true at publication. Today it is a draft, not sent.)

### 7. The correction request
- Filed https://github.com/github/advisory-database/issues/10743 on 2026-10-28 23:09 JST.
- Asked: remove `= 0.1.1` from the affected versions, keep `= 0.1.2`; if 0.1.1 is listed for a reason not in public data, add that reason.
- Its stated limits: we cannot see what GitHub's analysts saw; whether SWH's loader verified the checksum is unchecked.
- **Rewrite this section to match the Issue's outcome** (accepted, declined, or reason added: facts only).

### 8. What we learned
- Treat malware lists as inputs that can be wrong, not as ground truth.
- Fix the evidence standard first and commit it (and say when it was decided after seeing results, as here).
- Independent archives plus hash checks work; but for removed versions jsDelivr rarely helps (988).
- False-positive detection for malicious-package data is now an item in the shadow-operation (LS) design.

### 9. Closing
- Where the data and scripts are (repo paths).
- An invitation to report mistakes.

## Key facts and sources

| Fact | Value (copied exactly) | Source |
| --- | --- | --- |
| Malicious denominator | 1,148 | docs/bench/2026-10-28-backtest-v5/README.md, malicious-v5.json |
| Primary 12h | 1,039 / 1 / 108 | same README, diagnostics/summary.txt |
| Primary 24h | 1,039 / 1 / 108 | same |
| Primary 72h | 1,065 / 1 / 82 | same |
| Primary 168h | 1,078 / 1 / 69 | same |
| Interval 12h, 24h | 1,039 / 1,148 = 90.51% – 1,147 / 1,148 = 99.91% | same |
| Interval 72h | 1,065 / 1,148 = 92.77% – 99.91% | same |
| Interval 168h | 1,078 / 1,148 = 93.90% – 99.91% | same |
| v4 lower bounds | 86.24% / 91.64% / 93.29% | same README |
| v4 reproduced | 0 differences | summary.txt "v4 reproduced differences: 0 []" |
| Gate | not met (with and without the exception) | summary.txt |
| Disputed | 2 (@ensdomains/buffer 0.1.1, freo-design-system 1.0.4) | README, "The disputed category" |
| Funnel | 124 / 12 / 988 / 22 / 2 | summary.txt, "disputed funnel" |
| Run | 2026-10-28T11:56:25Z–12:55:30Z (20:56:25–21:55:30 JST), exit 0 | run-times.txt |
| SWH rate-limit waits | 37 and 15 minutes | README |
| buffer 0.1.1 sha1 | `6c275ba7e457e935405b67876f1f0d980c8baa63` | malicious-v5.json, ghsa-correction-request.md |
| buffer 0.1.1 SWH directory | `swh:1:dir:3d9e48db08c991644ad0eba0475ca1fbd9ecc047` | ghsa-correction-request.md |
| Correction request | https://github.com/github/advisory-database/issues/10743, filed 2026-10-28 23:09 JST | owner's record |
| PR | Ludion-ai/ludion #167 (merged 2026-10-28 22:32:03 JST, `51a8f0b`) | GitHub API |
| freo analysis | `/workspace/ludion/ghsa/freo-design-system-1.0.4-analysis.md` (on the box, not committed) | this investigation |

## Not to be claimed until the Issue is resolved

- That GitHub's database "is wrong", or that 0.1.1 is "safe" or "benign". What can be said: in public data, 0.1.1's code equals 0.1.0's and it has no install script (v5 itself says "not that V is benign").
- That GitHub acknowledged or fixed it, until that happens.
- Any guess at how or why 0.1.1 was added, or what GitHub's analysts did.
- "99.91%" on its own: it is an upper bound and only appears together with the lower bound 90.51%. Nor "we stopped everything except the database's error": 108 / 82 / 69 remain unknown and the gate is not met.
- That freo-design-system is a false positive. It is not; it is an example of a gap.
- The freo publisher's intent (bug-bounty or not).
- That the freo addition request was sent, unless it was.
- Quotes from Issue comments or GitHub staff without permission.

## Notes

- Before the Issue is resolved, "error" in the title reads as a verdict. Depending on the outcome, soften it (e.g. "a likely error").
- Publication is the owner's decision, after Issue #10743 is resolved.
