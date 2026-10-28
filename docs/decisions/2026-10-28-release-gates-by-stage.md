# 2026-10-28 (cycle 3, LS) — The release conditions reassembled: preview comments and automatic merge

Moved here unchanged from docs/decisions.md, under the one-record-per-file rule (2026-10-29). It was first committed as cdea65e05ecb6045ec0733a952af0f7494b4c8ef at 2026-10-28 22:49:56 JST (PR #175), before the shadow design and its measurement. The text below is that entry's, with only its heading turned into this file's title.

"This file" in the last bullet meant docs/decisions.md. Under the new rule, how (b) is counted is fixed in its own file, docs/decisions/2026-10-29-shadow-counting.md.

---
**Decided after seeing v5's results** (v5 の結果を見た後に決めた（オーナー決定 2026-10-28 22:46 JST）). The owner chose F1 to F3 as recommended; this entry fixes them before anything they govern runs.
- **Preview release (comments only)** needs all three: the noise measurement's miss gate met (L1); the workspace false stop fixed (L9); the protected-path PR "LP" merged. The malicious backtest is not a condition here, because the judge never says "apply".
- **Automatic merge** needs both:
  - (a) zero misses of confirmed malicious versions in the past backtests. A disputed version that meets v5's evidence standard (docs/bench/2026-10-28-backtest-v5/definitions.md, section 3) stays in the denominator, is shown apart, and is not counted as a miss.
  - (b) four consecutive weeks of shadow operation with zero misses on versions that received a MAL- record, and at least 100 decided judgements.
- **Unchanged.** The wait table and every gate's numeric criteria. This entry does not change the backtest's own gate (v5 definitions, section 6: every malicious version stopped, missed or unknown counted as not stopped).
- **Not yet fixed.** How (b) is counted (the unit, "decided", "miss", the start of the four weeks) is fixed in this file before the shadow starts. A proposal is in docs/bench/2026-10-28-shadow-design/. The shadow is not built and has not run; where it runs needs the owner's approval.
