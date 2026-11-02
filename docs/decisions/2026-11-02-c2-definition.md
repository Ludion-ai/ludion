# 2026-11-02 — C2: how the shadow counts malicious attacks (LC2DEF)

To be merged before the first week of the window ends (2026-11-05 00:51 JST), so that the definition is not changed after a result is seen. It is not changed after its results are seen: a later change is a new record that says what had been seen by then. The only replay this repository records is the preliminary run of 2026-10-29, with every version pending, 0 decided and no MAL- record naming a version in the window (docs/progress/2026-10-29-ls-shadow-replay.md:26 to :29). Whether a later replay was run is 不明; the lane that wrote this record read no capture and no replay output.

Short names: `final.md` is docs/decisions/2026-11-02-definition-of-complete-final.md, `corrections.md` is docs/decisions/2026-11-02-definition-of-complete-corrections.md, `shadow-counting.md` is docs/decisions/2026-10-29-shadow-counting.md, and `unit.md` is docs/decisions/2026-10-31-independent-unit-of-counts.md. "main" is 5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94. Times are JST unless they end in Z.

**Who decided.** The unit, the window, the tail, the removal of the low row, the frozen code and the missing days are the owner's plan (final.md:1, final.md:111 to final.md:114). How k and the misses are counted, in section 1, is the 頭脳's answer of 2026-11-02 17:58 JST. The owner's OK of that answer: 不明.

**CLAUDE.md still wins.** CLAUDE.md:34 makes automatic merge need condition (b), four consecutive weeks and at least 100 decided judgements, "counted as fixed in" shadow-counting.md, and final.md:3 says CLAUDE.md wins until the protected PR lands. This record does not change CLAUDE.md, the wait table or any gate's numeric criteria. It defines C2. It does not by itself change what (b) requires.

## 1. The definition

1. **The unit is the attack, not the version** (final.md:111): "the versions made by the same mechanism" (unit.md:15).
2. **The line is C1-1's** (final.md:98, final.md:111): whether the wait rule (final.md:72, as corrections.md:12 corrects it) could have let it be chosen.
3. **Two counts, both always written.**
   - **k** is counted **before** the oldest-version resolution (the oldest arm): the number of attacks in the window that could have entered a fix's tree.
   - **Misses** are counted **after** every rule.
   - An attack is a miss if any of its counted versions is a miss. A smaller count would be looser than shadow-counting.md:69, which allows no miss on any counted version.
4. **To pass is to have 0 misses.** k=0 passes too, and k is always written. A sentence that says it passed gives, on the same line, n and the 95% upper limit (corrections.md:14): n is k and the limit is 1 − 0.05^(1/k) (unit.md:17), so 0/2 is 77.6%, and k=0 gives no limit below 100%.
5. **The window is four weeks, ending 2026-11-26 00:51 JST** (final.md:112). That is 2026-11-25T15:51:48.401Z in the preliminary run (docs/progress/2026-10-29-ls-shadow-replay.md:26).
6. **The tail is 144h** (final.md:112). With the low row out, the longest wait is normal's 72h extended to max(2 × 72h, 72h) (packages/cli/src/security/judge.ts:9, judge.ts:13, judge.ts:813). A MAL- record counts if it is published by the window's end plus 144h.
7. **The rows are exploited, high and normal.** The low row is out (final.md:112). judge.ts:9 keeps `low` as it is.
8. **The result is on 2026-12-02 00:51 JST** (final.md:112), the window's end plus 144h.
9. **It is judged by the frozen code, not by the commit at the start** (final.md:112). If freezing is late, completion is the later of the replay after the freeze and 2026-12-02 (final.md:250). A fix needed after the freeze means the replay is run again (final.md:120).
10. **A missing day extends the window and is counted as a capture gap; it does not start the count again** (final.md:114).
    - A missing day is what it is in shadow-counting.md:16: a UTC calendar day with no successful poll, a stop at the storage limit that lasts a calendar day included.
    - Each missing day adds one day to the window, so the result moves with it (item 8).
    - The report gives the number of missing days, besides each row's capture gaps (shadow-counting.md:76).
    - A capture gap on a counted version is still a miss (shadow-counting.md:64). So a missing day cannot hide an attack.
11. **Disputed versions: not changed.** shadow-counting.md:54 to shadow-counting.md:66 stand, per version: confirmed versions and record-omission candidates count as malicious; false-report candidates stay in the denominator, are shown apart and are not counted as misses. How that rolls up to an attack is 未定 (section 2).
12. **The floor (100 decided judgements): オーナーの答え待ち.**
13. **If there is a miss** (final.md:113): it is fixed and recorded, and automatic merge does not open. Whether it opens is the owner's, and that case and its fix are published. The count is looked at every week (final.md:113).

**What a pass does not say.** C2 counts only the names on the frozen watched list (shadow-counting.md:8; 7,660 names, docs/progress/2026-10-29-ls-shadow-recording-start.md:10). A wider net comes after release (final.md:114). With k=0 it says nothing about the miss rate.

**One weakness.** The frozen code is written while the window runs, after part of the data is recorded. What answers it: this definition is fixed first, and the code that judges is to be public (docs/status.md, C2's row).

## 2. Not decided here (未定)

- **What "could have entered a fix's tree" is computed from.** The recorder stores MAL- records only (tools/shadow/src/recorder.ts:5, recorder.ts:80; shadow-counting.md:34), so the store holds no fix to build a tree from. The backtest's `selection` works from a fix's tree (tools/backtest/src/malicious-v5.ts:429). Main's replay gives each version a synthetic fix (tools/shadow/src/replay.ts:321), which treats every counted version as chosen. Which of these k reads, or what else it reads: 未定.
- **What decides that two versions are one attack.** unit.md:15 gives the meaning, not the evidence. 未定.
- **A disputed version inside an attack.** An attack whose versions are in different categories of shadow-counting.md:54 to shadow-counting.md:66: 未定. Until then the versions and their categories are shown as those lines say.
- **The margin after the tail.** replay.ts:600 keeps a report from being final until an OSV read 24h past the tail (replay.ts:23), and the recorder reads OSV once per UTC day (recorder.ts:368). With no missing day and only the tail changed, the first final report is on 2026-12-03 09:00 JST or later, not on 2026-12-02 00:51 JST. With no margin at all, it is 2026-12-02 09:00 JST or later. Which of these moves: 未定.

## 3. Where main differs

Each row's references are at main's full SHA, in the form `<sha>:<path>:<line>`; a `:<line>` after it is in the same file.

| What | Main says | C2 says | Main's file:line |
|---|---|---|---|
| The unit | The version: misses are listed per version, and the report has no k | The attack, with k and the misses both written | `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:docs/decisions/2026-10-29-shadow-counting.md:69`; `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:tools/shadow/src/replay.ts:478`, `:613`, `:632` |
| The tail | 336h, and a report is final only after an OSV read 24h later | 144h (the margin: section 2) | `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:docs/decisions/2026-10-29-shadow-counting.md:21`; `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:tools/shadow/src/replay.ts:21`, `:23`, `:364`, `:575`, `:599`, `:600` |
| The code that judges | The judge at the commit recorded at the start, also for a rerun | The frozen code | `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:docs/decisions/2026-10-29-shadow-counting.md:24`; `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:docs/bench/2026-10-29-shadow-replay/scripts/run.sh:28`, `:33`; `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:tools/shadow/src/replay.ts:4` |
| The rows | Four, with low; a decided version needs all four | Exploited, high and normal | `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:docs/decisions/2026-10-29-shadow-counting.md:25`, `:29`, `:70`; `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:tools/shadow/src/replay.ts:24`, `:310`, `:461`, `:463`; `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:docs/status.md:108` |
| A missing day | Ends the run: the four weeks start again at the next successful poll | Extends the window, and is counted as a capture gap | `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:docs/decisions/2026-10-29-shadow-counting.md:16`; `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:tools/shadow/src/replay.ts:222`, `:235`, `:238` |
| What is judged | One change, P from prev to V or V as a new package, with T as V's publish time. Nothing chooses a version, so the oldest choice is not in it | Every rule, the oldest choice included, for the misses; before the oldest choice, for k | `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:docs/decisions/2026-10-29-shadow-counting.md:25`, `:41`, `:42`; `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:tools/shadow/src/replay.ts:311`, `:321`, `:396` |
| The floor | At least 100 decided judgements | オーナーの答え待ち | `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:CLAUDE.md:34`; `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:docs/decisions/2026-10-29-shadow-counting.md:70`; `5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94:tools/shadow/src/replay.ts:483`, `:631` |

docs/status.md:108, in the rows' row, records the owner's decision of 2026-10-30 that (b) is counted on all four rows. The plan, adopted later, takes the low row out (final.md:28, final.md:112). That sentence is about (b) and is not edited here.

## 4. What this replaces in shadow-counting.md, and what stays

shadow-counting.md is not edited, since it says it is not changed after its results are seen (shadow-counting.md:3). For C2, this record overrides it as follows. For (b), CLAUDE.md:34 still names it whole.

| Section | For C2 |
|---|---|
| 1 What is watched | Stays |
| 2 The four weeks | **Replaced**: a missing day extends the window (item 10). What a missing day is, and that moving the recorder without losing a day ends nothing, stay |
| 3 Which versions count | The window's versions stay. **Replaced**: 336h becomes 144h (item 6) |
| 4 One judgement | **Replaced**: the judge's commit (item 9), the low row (item 7), and what is judged (section 3). Scenario (a), which had the normal and low rows, keeps normal only. Its inputs and the moment of the judgement stay until the code in section 5 is written |
| 5 The outcome of one row | Stays. Combining stays, over the three rows |
| 6 Malicious versions | Stays, per version (item 11) |
| 7 The gate | **Replaced**: misses per attack, with k (items 3 and 4). The floor is item 12. The "No cases" sentence stays, with k=0 written as item 4 says |
| 8 Shown next to the gate | Stays, over the three rows. k and the number of missing days are added |
| 9 What the recorder must capture | Stays. Section 2's first item may add to it |

## 5. The code is not changed here

This record changes no code. No code on main computes C2: `oldest` appears nowhere in packages/cli/src or tools/shadow/src, and the replay still counts as section 3's "Main says" column does.

- The replay's fixes (the tail, the rows, the unit, the commit that judges and the window) are made by 2026-11-26 in C12's list. C12's list as it stands (final.md:200 to final.md:210) does not name them yet.
- The tests, which do not exist yet (まだ無い): `c2-final-at-window-plus-144h` and `c2-counts-attacks-before-the-arm`.
