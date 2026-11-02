# 2026-11-01 — LC3's definitions, fixed before measuring

LC3 measures. It changes no code of the gates or the plan, no row of the wait table and not C3's line. The definitions below were committed and pushed before any part of the 200 was judged. They are not changed after the result is seen; a correction is a new, dated section here, saying what had been seen by then.

The lane's brief is the brain's answer on the operations board (ludion-ops comment 6556208299, section 4). Its sentences this record has to follow, word for word:

> docs/bench/2026-10-28-backtest-v4 の 200 件を、main の今の judge で測り直す。資格情報の無いコンテナの中で。

> 止めた理由ごとの数を出す。

> deprecation で止めたものは、二つに分ける。修正の時点で分かっていたもの（時点の記録があれば）と、今日の registry でしか分からないもの。時点が取れなければ、上下の幅で出す。

> 止めた 35 件それぞれで、次の候補を引き直したら全部の関門を通るかを数える。

> 次の候補は、修正の公開時刻 + 待ちの時点で公開されていた、同じメジャーで一番小さい、deprecate されておらず、新しい勧告も無い修正版。

> C3 の線（95% の上限 ≤ 5%）には、止めるのを 4/200 以下にする必要がある。だから、この形で 31 件以上が通れば、計画の変更で届く。

> 引き直しは、関門を緩めない。悪い版は、今と同じく当てない。

**What had been seen when this was written.** The README of docs/bench/2026-10-28-backtest-v4 (35 of 200 stopped, its table of stops per signal, its list of next.js families), the first 1,800 bytes of fixes-v4.json (its summary, not a row) and the brain's hypothesis. Not read: any row of fixes-v4.json, any deprecation message, and any result of main's judge on these 200.

## 1. What is measured

**The sample.** The 200 rows of docs/bench/2026-10-28-backtest-v4/fixes-v4.json, as they are: `id`, `name`, `from`, `to`, `fix_published`, `advisory_published`. No new draw and no replacement. A row whose facts cannot be read stays in the denominator as undecidable (v4 could skip such a row while drawing; it skipped none).

**The judge.** main at 4aefb22, unchanged: `gatherFacts` and `judge` (packages/cli/src/security/npm-facts.ts, judge.ts), `sameRelease` (time-cap.ts), `comparePublishers` and `nextFix` (next-fix.ts). Each row is the one change `from` → `to`, as in v4: `dev: false` (every changed version counts as production), `direct` naming the package, `files` naming package-lock.json, `now` far past every wait, facts as of today.

Three things are as v4 did them, on purpose, so that the two numbers can be compared:

- **Rule 1 on a fresh tree.** main's judge sees only the change it is given, and a row has no lockfile. So the fix's dependency tree is resolved as tools/backtest/src/fixes-v4.ts does it, with no lockfile: each requirement goes to the highest version published before T, or to one published in [T, T + 24h) that the same-release exception allows (main's `sameRelease`). A requirement nothing satisfies is a stop. A branch that cannot be read is not a stop: it is counted apart, as in v4.
- **Urgency** comes from today's KEV list and today's EPSS scores.
- **The wait is not a stop.** `now` is past it, so `wait` never appears.

One thing differs from v4: the change carries the registry's real sha512 integrity, not v4's `sha512-backtest`, so gate 4's findings count. v4 had to leave gate 4 out.

**Stopped** means: the judgement's verdict is `stop` or `undecidable`, or rule 1 finds a requirement nothing satisfies. Its opposite is `ready_except_build`. **Gate 3 is not measured:** nothing is downloaded or run. Wherever this record or its result says "passes", it means gates 1, 2 and 4 as the judge has them, and the time cap, and nothing about whether the update builds. Gate 1's OS, SAPI and configuration conditions are not matched, as the judge says of itself.

**What is sent.** Package names and versions to registry.npmjs.org (packuments and attestation records) and to api.osv.dev, and, back to OSV, the ids of the records it returned. No tarball is fetched. The judge's `gatherFacts` also downloads CISA's KEV list and FIRST's EPSS list whole, as it does in the product; nothing is sent to either. Without them the judge cannot run, so this is read as part of "main's judge", though the brief names only the registry and OSV. All of it runs in a container with no credentials and no forwarded host environment.

## 2. The stop reasons

Each stop message is put in one signal, by v4's patterns (`signalOf`), with these added for what main has since v4:

| Signal | The judge's message |
| --- | --- |
| deprecation | `is deprecated` |
| gate 1: new advisories | `has known advisories` |
| install scripts | `install scripts` |
| provenance | `had build provenance`, `was built from` |
| provenance: repository id | `GitHub repository id` |
| provenance: event | `was published from a GitHub`, `no triggering event` |
| withdrawn | `no longer listed` |
| MAL- record | `malicious-package records` |
| rule 1 (tree) | a requirement nothing satisfies |
| rule 2 | `New dependency` |
| gate 1: downgrade | ` goes down from ` |
| time cap undecidable | `Time cap:` otherwise |
| gate 4 | a finding of gate 4 |
| facts unreadable | `A lookup failed`, `No registry facts`, `has no publish time` |
| other | anything else, listed with its text |

For each signal: **fires** (rows it stops) and **alone** (rows it stops with no other signal), as in v4. Every row that changes between v4's verdict and main's is listed with what changed.

## 3. The two kinds of deprecation, and the range

The registry does not say when a version was deprecated, and no record in this repository is older than the fixes. So the split is mostly a range. The moment that counts is the **cutoff**, T + w:

- T is the row's `fix_published`.
- w is the `wait_hours` main's judgement of `from` → `to` gives, extensions included (`wait_hours` is computed whether or not the judgement stops).

That is when the wait ends and the product reads gate 2 again (design, "「安全」の定義").

For each row with a deprecation stop, on the deprecated version `to`:

- **K, known at the cutoff:** the package's registry `time.modified` is at or before the cutoff. A deprecation moves `time.modified` (time-cap.ts, `Releases`), so nothing has changed since, and the deprecation was already there.
- **L, written later, by its own text:** not K, and the deprecation message names something that did not exist at the cutoff:
  - a version of the same package (a token `\bv?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\b`) with a registry publish time after the cutoff;
  - or a `GHSA-…` or `CVE-…` token that is the id or an alias of a record OSV returned for `from` or `to`, with that record's `published` after the cutoff;
  - or a date token `YYYY-MM-DD` after the cutoff.
- **U, no evidence of when:** neither.

The result is given as:

- known at the cutoff: from K to K + U;
- only in today's registry: from L to L + U;
- the widest range, since a message can be rewritten and so L is evidence and not proof: known at the cutoff from K to K + L + U.

The same split is given for the rows deprecation stops **alone**, since those are the ones whose verdict turns on it.

## 4. The next candidate

For each row stopped in section 1, whatever the reason, one candidate is drawn, and only one:

1. **When the smallest has a MAL- record, there is no candidate:** the fix stops (docs/decisions/2026-10-30-mal-smallest-stops-the-fix.md).
2. **The versions looked at:** those of the same package with a registry publish time, greater than `to`, not a prerelease, the same major as `to`, published at or before the cutoff of section 3. Publish times are the registry's. The comparison includes the cutoff itself.
3. **Passed over, each with its reason:**
   - not listed by the registry;
   - deprecated (a non-empty `deprecated`);
   - in a MAL- record OSV does not mark withdrawn (a later version with one is passed over, as in next-fix.ts);
   - named by the row's own advisory `id`, as it is then not a fixed version;
   - **a new advisory:** named by a record OSV does not mark withdrawn, that does not name `from`.
4. **The candidate** is the smallest version left. Nothing further is tried if it then fails.
5. **The publisher check:** `comparePublishers(to, to's identity, candidate, candidate's identity)`, as `ludion patch` does when it takes a version in place of the smallest (docs/decisions/2026-10-30-next-fix-same-publisher.md). A `to` the registry no longer lists has no identity, so the check stops. A stop here means the candidate does not pass.
6. **The gates:** the judge and rule 1 of section 1 on the change `from` → candidate, where T for rule 1 is the candidate's publish time. It passes on `ready_except_build` with no requirement unsatisfied.

**The count asked for** is the number of stopped rows whose candidate passes steps 5 and 6, written as the raw number against 31. If main stops N rows and N is not 35, then N − 4 is given beside 31, since 4 of 200 is what the line needs. The funnel is given too: rows with no candidate and why, candidates found, passed the publisher check, passed the judge, passed rule 1.

**The readings.** The brief's sentence reads deprecation and advisories as of today, so hindsight counts against a candidate as it does against `to`. So three readings are computed, from the same run:

- **Reading A, the answer:** today's registry and today's OSV, as written above.
- **Reading B, the upper side of section 3's range:** a deprecation counts only when K holds for its package (`time.modified` at or before the cutoff). This applies to `to` and to the candidate, in step 3 and in the judge's facts. A row that then has no stop passes as it is, with no candidate.
- **Reading C, added here, not asked for:** reading B, and also an advisory counts only when its OSV record's `published` is at or before the cutoff, in step 3 and in the judge's facts.

Each reading gives the final number stopped out of 200, to set against 4. Reading A answers the brief. B and C say how much of it is hindsight; neither replaces it.

**Beside the count, not part of it,** so that the difference between this rule and main's plan can be seen:

- For the candidates that pass in reading A: how many are also inside next-fix.ts's own limits. These are the same minor below 1.0.0, and named by no OSV record at all (next-fix.ts passes over any record; the brief's sentence passes over new ones).
- For each stopped row: what main's `nextFix(name, to)` chooses today, and whether that version was published at or before the cutoff. main's rule has no cutoff. The judge is not run on these.
- The count without the publisher check of step 5, so that its effect can be read.

## 5. Delay, for C7, not asked for

Since the run gives them for nothing, the result also gives, per urgency, v4's formula, added delay = max(0, newest + w − advisory publish), with n, median and p90 by v4's index, and the share of rows with a wait-extending finding: for main's judge with no new candidate, and for reading A with them. This is not a C7 judgement.

## 6. How the run is taken

- **One complete run is the result.** A network failure is retried up to four times, and what still fails counts as undecidable. Another run with the same cache may repeat only requests that failed, and if one is made, the result says so. A smoke run on a few rows before it, needed to test the script, is disclosed in the result by which rows it read. A smoke run's output is not a result.
- **The limits, stated with the result:**
  - Nothing here measures the malicious side. The brief counts a re-draw as loosening for C2's clock (it can apply a version that would not have been applied), and how many malicious versions a re-draw could select is not measured.
  - Gate 3 is not run, so a candidate that passes here may still break.
  - Rule 1 with no lockfile is an upper bound on its stops, as in v4.
  - Reading B's and C's facts are today's facts with some removed, not the registry as it was: an un-deprecation or a rewritten record is not seen.
- **The results** go in docs/bench/lc3/, the record in one docs/progress/2026-11-01-lc3-*.md file, and no code of the gates or plan changes in this PR.
