# 2026-11-02 — C2: how k and the misses are read (LC2REC)

**What had been seen when this was written.** The lane that wrote this record opened no store, no artifact, no replay output and no interim count of C2, and did not open docs/progress/2026-10-29-ls-shadow-replay.md. It did read two sentences about a replay, because they stand in a record it had to read: c2-definition:3 says the preliminary run of 2026-10-29 had every version pending, 0 decided and no MAL- record naming a version in the window, and that whether a later replay was run is 不明; c2-definition:20 gives the window's end in that run. Under docs/progress and docs/bench, no file name with `replay` in it is dated after that run; that is a check of names, not of contents. This lane's brief says that neither the writer of the lines below nor the separate check of them has seen C2's interim counts; this lane has that statement and nothing more behind it. Whether anyone else has read them: 不明.

Short names: `c2-definition` is docs/decisions/2026-11-02-c2-definition.md, `shadow-counting.md` is docs/decisions/2026-10-29-shadow-counting.md, and `final.md` is docs/decisions/2026-11-02-definition-of-complete-final.md, cited by the lines of the file. `replay.ts` is tools/shadow/src/replay.ts and `recorder.ts` is tools/shadow/src/recorder.ts. Lines of code and records are as read at main, cdc39785bb0aebae7f3a3907ed619747e530c19f. Times are JST.

**Who decided.** The lines in section 2 are the answer given on 2026-11-02 after the withdrawal in section 1; the indented sub-lines under lines 1, 2 and 9 are this lane's, and the one under line 6 is the answer's. The owner's OK of them: 不明. The answer says the owner has been told of line 8's date; this lane did not see that message.

**What this record does.** It settles the five points c2-definition section 2 leaves 未定, as c2-definition:3 asks: what k is computed from (line 1), what makes two versions one attack (line 7), a disputed version inside an attack (line 6), the margin after the tail (line 8) and the rows of the 100 (line 9). For C2, it also sets aside item 11's "not counted as misses" (line 6). It does not edit c2-definition or shadow-counting.md. It does not change CLAUDE.md, the wait table or any gate's numeric criteria.

## 1. Withdrawn

Two statements in an earlier answer on how to count C2 are withdrawn: 「範囲で一番新しい版を取る、npm の既定の解決」 (take the newest version in the range, npm's default resolution) and 「最古を含む」 (include the oldest).

replay.ts:292 `syntheticFix` only returns a fix from prev to V; it reads no range and no resolution. replay.ts:321 only passes that to `fixes`. The separate check and c2-definition section 2 were right. The withdrawal says the answer was written without reading those lines (docs/mistakes/2026-11-02-decision-cited-code-lines-not-read.md).

## 2. The lines

A **counted version** is what c2-definition section 4 leaves of shadow-counting.md section 3: a version of a watched name published in the window, named by a MAL- record published by the window's end plus 144h. Line 6 says how disputed versions count.

1. **k.** The number of attacks in the window with at least one counted version on a watched name. Every counted version is counted as chosen (the synthetic fix at replay.ts:321). No tree is read.
   - replay.ts:321 gives that fix in scenario (b). In scenario (a) the same line gives no fix, and V is judged as a new direct dependency (replay.ts:325). Neither reads a tree.
2. **A miss.** An attack with a counted version that `judge()` did not stop, in any of the three rows, by the end of the wait. A capture gap is a miss too (shadow-counting.md:64). The oldest rule has no effect: the replay chooses no version, so the oldest rule does nothing (c2-definition section 3). C2 does not need the oldest-version code; the fixes to the window, rows, unit, tail and freeze are still needed in C12.
   - What a row's outcome is stays as shadow-counting.md section 5 says (c2-definition section 4): stopped is `stop`, or `undecidable` with every input taken from captures; missed is `ready_except_build`.
3. **c2-definition item 3.** Its sentences (k before the oldest arm, misses after every rule) hold under this reading. Section 1 is not edited; this record is how it is read.
4. **If there is a miss.** That attack gets one line: whether the oldest rule would have avoided it, and on which tree that was checked (a person checks this afterwards). Whether automatic merge opens is the owner's (final.md:113).
5. **k on the oldest tree.** Not computed.
6. **Disputed versions.** In C2, a false-report candidate is treated as a counted version, marked, and shown apart. An attack of false-report candidates alone is in k, and if `judge()` did not stop it, it is a miss (marked). c2-definition item 11's "not counted as misses" is not used in C2. The per-version display stays as shadow-counting.md says.
   - Why: the candidate check is a mechanism that guesses, and when it is wrong it lets a real attack through. What is lost is only that opening comes later, and whether it opens is the owner's, looking at the one case, which is public.
7. **The same attack.** An OSV alias or a campaign. Where there is neither, the same package within 7 days.
8. **The 24-hour margin.** It stays. The first final result is on 2026-12-03 09:00 JST or later (c2-definition section 2 gives the arithmetic: replay.ts:23, replay.ts:600, recorder.ts:368).
9. **The rows of the 100.** The same three rows as C2.
   - The number stays 100. shadow-counting.md:70 counted four, and replay.ts:463 takes the decided count from ROWS, which has four (replay.ts:24). Three rows ask less of a version than four.
   - CLAUDE.md:34 cites shadow-counting.md for the 100, and final.md:3 says CLAUDE.md wins where the two differ until a protected PR lands. Whether that citation needs changing is not decided here.
10. **Shown next to the count; not a line: `shadow-osv-recall`.** For each update date, whether the MAL- ids the recorder read include every id in OSV's index. It stands next to the 100.
11. **What had been seen.** The first paragraph of this record.

## 3. Written later, not here

This PR changes no code and adds no test. These names are for C12's fix of the replay:

- the test `c2-k-counts-every-attack-on-a-watched-name` (line 1);
- the test `c2-miss-does-not-read-a-tree` (line 2);
- `shadow-osv-recall` (line 10), which is shown next to the count.

Line 6 differs from replay.ts:594, where `counts_as_malicious` is false for a false-report candidate, so that fix has to cover it as well. The review item `decision-names-code-it-read`: when a decision cites a file:line, its writer has read that line.
