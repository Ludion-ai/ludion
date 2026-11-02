# 2026-11-03 — C2: the n of the 95% upper limit, and lines 4, 6 and 9 amended (LC2REC2)

**What had been seen when this was written.** Nobody has seen C2's interim counts: that is what the judgement below states, and for anyone other than this lane, this lane has that statement and nothing more behind it. The lane that wrote this record opened no store, no artifact, no replay output and no interim count of C2. The only data it used is public data from 2025: the versions and publish times in docs/bench/2026-10-28-judge-backtest/malicious.json, the MAL- records in docs/bench/2026-10-28-shadow-design/out/measure.json, and backtest v4's 200 fixes, whose advisories were all published in 2025 (docs/bench/2026-10-28-backtest-v4/fixes-v4.json). tools/shadow/watched.json gives the frozen list of names, not a count. measure.json also holds a sample from a window that ended on 2026-10-28, before C2's window; this lane saw those lines and used none of them. About C2 itself it read only what records say: c2-definition:3 and :20, and docs/status.md:11 ("C2 has no result yet").

Short names: `reading` is docs/decisions/2026-11-02-c2-counting-reading.md, cited as "line N" for the numbered lines of its section 2. `c2-definition` is docs/decisions/2026-11-02-c2-definition.md, `shadow-counting.md` is docs/decisions/2026-10-29-shadow-counting.md, `final.md` is docs/decisions/2026-11-02-definition-of-complete-final.md, `unit.md` is docs/decisions/2026-10-31-independent-unit-of-counts.md, and `replay.ts` is tools/shadow/src/replay.ts. Lines of code and records are as read at main, 4718d34ecef5451876ea53a9dcfaca2e1f3bee7e. Times are JST.

**Who decided.** Sections 1 to 4 are the judgement of 2026-11-03 03:48 JST. The owner's OK of it: 不明. Sentences under the heading "This lane's notes" are this lane's and decide nothing.

**What this record does.** It does not edit `reading`, c2-definition or shadow-counting.md. It adds a rule for n, which replaces "n is k" in c2-definition:19, and it changes lines 4, 6 and 9 of `reading`. The other lines of `reading` stand. It does not change CLAUDE.md, the wait table or any gate's numeric criteria. C2's line stays 0 misses.

## 1. The n of the 95% upper limit

**n is the number of chains.** Take the counted versions on watched names and sort them by publish time. Two neighbours whose publish times are at most 7 days apart are in the same chain, so a chain can be longer than 7 days as long as no gap is. A chain made only of false-report candidates is not counted in n. The limit stays 1 − 0.05^(1/n), and n = 0 gives no limit below 100% (c2-definition:19).

- **Where it is written.** A sentence that says C2 passed gives n and the limit on its line (CLAUDE.md:34), with line 7's k next to n. k is still always written (c2-definition:15).
- **What this replaces.** c2-definition:19 says "n is k". unit.md:17 gives the same formula with k. For C2's limit, n replaces k in that formula. k keeps its meaning.
- **The 7 days do not change after results are seen.**
- **A chain is not a finding that its versions are one mechanism.** If different mechanisms fall into one chain, that is written in a note and n stays as it is. The limit then comes out higher, which is the honest side.

Why: for versions on different packages, line 7 has only an alias to join them. In the wave of 2025-09-08, 17 versions on watched names have 17 MAL- ids and 17 package names, and they were published within 8 minutes (docs/bench/2026-10-28-judge-backtest/malicious.json; the first by time is at :3397 and the last at :3637). The rows hold no alias field, so whether any record has an alias is 不明 from this data. If no alias joins them, line 7 alone can count them as 17 attacks. As k, that gives a limit of 16.2%. As one chain, n = 1 gives 95%.

### This lane's notes

- **2025 under this rule.** In the same file, 46 versions published in 2025 are on watched names, and they make 4 chains of 9, 15, 17 and 5 versions. This is an illustration only. The file does not hold every record: MAL-2025-47141 names @ctrl/tinycolor, a watched name, and is in measure.json:636, but the file has no row for it. Whether its versions join the wave's chain is 不明 from this data.
- **Candidates inside a chain.** Line 6 makes a false-report candidate a counted version, so it is sorted in with the others. It can join two chains into one. That lowers n and raises the limit.
- **No publish time.** A counted version with none cannot be placed in a chain. It is a capture gap (replay.ts:589), so a miss (line 2), and a sentence with a miss has no limit to give.
- **Not decided here: n larger than k.** One attack by line 7, through an alias, can have versions more than 7 days apart. That makes two chains from one attack, so n can be larger than k, and the limit lower than k's. This record does not say what is written then.

## 2. Line 6 is amended

In line 6 (`reading`:28), "if `judge()` did not stop it" becomes "if it is a miss by line 2". The sentence is now: "An attack of false-report candidates alone is in k, and if it is a miss by line 2, it is a miss (marked)."

Why: line 2 counts more than the judge's verdict. It also counts a capture gap, where the judge is not run (shadow-counting.md:51), and it asks each row by the end of that row's wait.

## 3. Line 9 is withdrawn

Line 9 and its two sub-lines (`reading`:32 to :34) are withdrawn. The 100 decided judgements are counted on four rows, as shadow-counting.md:70 says ("with `stop` or `ready_except_build` in every one of the four rows"). CLAUDE.md:34 cites that file for the 100, and CLAUDE.md wins where the two differ until a protected PR lands (final.md:3).

| What | Rows | Read at |
|---|---|---|
| The replay computes | Four: exploited, high, normal, low | replay.ts:24, replay.ts:463 |
| C2's misses are counted on | Three: exploited, high, normal | c2-definition:22, line 2 |
| The 100 are counted on | Four | shadow-counting.md:70, CLAUDE.md:34 |

This settles the open point at c2-definition:44. The 100 stay outside C2's line (c2-definition:31). C2's rows stay three: the withdrawal does not bring the low row back into C2's misses.

### This lane's notes

- **The low row can still be waiting at C2's date.** Its wait is 168h (packages/cli/src/security/judge.ts:9), and extended it is 336h (shadow-counting.md:21). C2's tail is 144h (c2-definition:21). A version published late in the window can have no verdict on the low row by then, so it is not decided, which only lowers the 100. But main's replay holds a report from being final while any row is pending (replay.ts:601, :602). Whether a pending low row holds C2's own result is not decided here, and C12's fix has to say.
- **The code is not changed here.** replay.ts:593 still takes missed rows from all four rows. C12's fix has to count C2's misses on three.

## 4. Line 4 gets more

In line 4 (`reading`:26), the one line for a miss also names the row and that row's share of fixes. A miss in more than one row names each. The line's form is:

`<attack>: missed in <row> (<share> of fixes, <fixes in the row>/<all fixes>, <file:line>); the oldest rule: <would have avoided it or not>; the tree it was checked on: <tree>`

The shares are C7's backtest, backtest v4:

| Row | Fixes in the row | All fixes | Share | Read at |
|---|---|---|---|---|
| exploited | 8 | 200 | 4.0% | docs/bench/2026-10-28-backtest-v4/README.md:55 |
| high | 34 | 200 | 17.0% | docs/bench/2026-10-28-backtest-v4/README.md:56 |
| normal | 158 | 200 | 79.0% | docs/bench/2026-10-28-backtest-v4/README.md:57 |

The same counts are in docs/bench/2026-10-28-backtest-v4/fixes-v4.json:13 to :18. C7's numbers are v4's, with the judge of 2026-10-28, and have not been measured again with main's judge (docs/decisions/2026-11-01-definition-of-complete.md:17). So these are the shares in that sample of 200, not the shares of fixes in general. A later measurement of C7 is a new record.

## 5. Tests and the review item

- **`c2-wave-is-one-attack`** in tools/records/test/records.test.ts: the 17 versions, read from the committed data, make one chain, so n = 1.
- **`c2-miss-names-its-row`** in the same file: the form in section 4 has the row and the share, and each row of the table agrees with the line it cites.
- **The review item `count-word-has-a-field`:** for each word that counts something, a field holds it. A reviewer checks this item. For this record:

| The word | The field | Read at |
|---|---|---|
| chain | a version's publish time: `published`, from the registry's `time` | replay.ts:438, shadow-counting.md:20 |
| false-report candidate | `category`, the value `false_report` | replay.ts:477, replay.ts:594 |
| row | `missed_rows`, `combined` | replay.ts:477, replay.ts:593, replay.ts:443 |

Line 7 is not amended here. Of the two words in its first sentence, the OSV alias has a field (`aliases`). The other has none in OSV, as the judgement says; this lane did not look further. The item will find that word when it reads line 7.

No code on main computes n. The rule is in the test as a small function, and the replay's code for it belongs to C12's fix, as `reading` section 3 says of the other tests.
