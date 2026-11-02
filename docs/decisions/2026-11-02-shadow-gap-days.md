# 2026-11-02 — The shadow's missing days: C2's window is extended, and they are counted as capture gaps (LGAP)

Short names: `final.md` is docs/decisions/2026-11-02-definition-of-complete-final.md, `c2.md` is docs/decisions/2026-11-02-c2-definition.md, and `shadow-counting.md` is docs/decisions/2026-10-29-shadow-counting.md. Line numbers are at main cdc39785bb0aebae7f3a3907ed619747e530c19f. Times are JST unless they end in Z.

**Who decided.** The owner decided on 2026-11-02 at 14:45 JST: a day with no recording extends C2's window and is counted as a capture gap, and this needs a protected PR. final.md:114 says the same. Section 1's item 2, which applies "counted as a capture gap" to the versions published on such a day, is from the coordinator's brief for this PR. The owner's OK of that wording: 不明.

**What had been seen by then** (c2.md:3 asks a later record to say). The lane that wrote this record read no capture and no replay output. The only replay this repository records is the preliminary run of 2026-10-29 (docs/progress/2026-10-29-ls-shadow-replay.md:26 to :29). Whether a later replay was run, and whether any day in the window has been missing so far: 不明.

## 1. The rule

A **missing day** is what shadow-counting.md:16 and c2.md:26 say: a UTC calendar day with no successful poll, a stop at the storage limit that lasts a calendar day included. A day partly inside the window counts.

1. **The window's end moves by one day for each missing day.** With m missing days, the end is 2026-11-25T15:51:48.401Z (c2.md:20) plus m × 24h. A missing day among the added days adds one more. The count does not start again.
2. **A version published on a missing day is counted as a capture gap, and the result always says so.**
   - This covers every version of a watched package whose publish time (shadow-counting.md:20) falls on a missing day, even if a later poll captured it. If such a version is replayed, the replay is shown beside the count and does not change it.
   - The result always writes the number of missing days, each one's date, and the number of versions published on each. No missing day is written as 0.
   - The number can be too low. A version removed before any read is in it only if the registry's `time` or a record shows it (shadow-counting.md:20). The result says that it is a lower limit.
   - What a capture gap means does not change. On a counted version it is a miss (shadow-counting.md:64, c2.md:29), and a row with one is not decided (shadow-counting.md:70). So a confirmed malicious version published on a missing day makes its attack a miss, and automatic merge does not open (final.md:113).
3. **Whether the result's date (2026-12-02 00:51 JST) moves: 不明。オーナーが決める。** No written decision says.
   - final.md:112 gives the date. final.md:114 and the owner's decision of 14:45 JST do not mention it.
   - c2.md:27 says "so the result moves with it", drawn from c2.md:23 (the window's end plus 144h), and cites no decision of the owner's for that step. That record is not edited. Until the owner decides, its sentence is not read as the owner's decision on the date.
   - What follows either way, as arithmetic and not as a decision. If the date stays, the time from the extended end to the result is 144h − m × 24h, so a MAL- record published by the end plus 144h can come after the result. If the date moves by m days, the result comes after 2026-12-02, the day automatic merge opens from (CLAUDE.md:33).

**Also not decided.** Whether a missing day after the window's end, in the 144h tail, does anything: the decision speaks of the window only. 不明。オーナーが決める。

## 2. What this replaces, and what stays

- **Replaced, for C2 only:** the "Breaks" point of shadow-counting.md's section 2 (shadow-counting.md:16), that a missing day ends the run and the four weeks start again at the next successful poll. shadow-counting.md is not edited.
- **Stays from that section:** what a missing day is, and that moving the recorder without losing a calendar day ends nothing (shadow-counting.md:17).
- **The four consecutive weeks,** kept after release as a record and no longer a condition (CLAUDE.md:34), are still counted as shadow-counting.md's section 2 says, breaks included.
- **c2.md:** this agrees with its item 10 and its section 4 (c2.md:25, c2.md:69). It adds item 2 above and leaves the date open, as item 3 above says.
- **Not changed:** the wait table, every gate's numeric criteria, the 144h tail, the three rows, the unit, and the 100 decided judgements.

## 3. The code is not changed here

This record changes no code. At main, `windowOf` still starts the four weeks again after a missing day (tools/shadow/src/replay.ts:222, :235 to :238), and nothing counts the versions published on such a day. That work is for a separate PR, with the replay's other fixes for C2 (c2.md:82).
