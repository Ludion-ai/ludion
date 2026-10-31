# 2026-10-31 — Each count names its unit of independence

**Decided 2026-10-31 01:49 JST** by the owner's Claude chat (ludion-ops#1 comment 6528291928, 3), which accepted finding 2 of the first hourly first-principles audit (comment 6527803283). Under comment 6525272283 ("毎時の監査"), audit findings that touch the goal, the scope, a gate, a wait or a rule are judged by the chat. Whether the owner has seen this decision is not on the board (不明).

## Why

The counts in docs/decisions/2026-10-31-counts-instead-of-days.md hold only when each sample fails independently with probability p (the audit; the formula and the numbers 299, 59 and 97 are right). The samples to be gathered are not independent:

- Malicious versions come in attacks. Of 2025's 1,412 malicious versions, three waves make 26 + 186 + 985 = 1,197 (85%) (the audit's count, from docs/bench/2026-10-28-judge-backtest/README.md). A gate tends to stop all of one attack's versions or pass all of them, so 299 versions can be evidence about only two or three attacks.
- Fixes in one project are correlated in the same way: with m samples per project and correlation ρ inside a project, the effective count is n / (1 + (m − 1)ρ).

## Decided

1. **Before counting, the definition PR fixes, row by row, the unit of independence.**
   - The row of malicious versions (悪性の行): the attack (the versions made by the same mechanism).
   - The row of breakage: the project (overlapping instances of the same update count as one).
2. **A claim is written with k, the number of those units.** With 0 misses, the upper bound is 1 − 0.05^(1/k).
3. **The row of malicious versions promises no p0.** Saying 1% there needs 299 attacks, more than past records hold. So it shows k and the upper bound as they are, and forward records raise k.
4. **The row of breakage takes more projects, 1 to 3 from each** (instead of the proposal's "at most 15 from one").
5. **The takeover measurement (LT)** reports the count per attack (k) as well as the count of versions.

Whether item 3 also covers the shadow's row (replacing condition (b)) is not stated in 6528291928 (不明). The audit finding it accepted applied the same argument to the shadow's row.

## When it takes effect

In LC0's definition PR (comment 6528291928, 3), before counting starts. Whether CLAUDE.md's text must change for this record is not on the board (不明); the change of condition (b) to a count is in docs/decisions/2026-10-31-counts-instead-of-days.md, and that CLAUDE.md change is LC0's, a protected PR the owner merges.

## Undo

A later decision, with its own record.
