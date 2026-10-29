### 2026-10-11: Switched to spec v2

- CLAUDE.md replaced by the v2 spec; `.claude/rules/` deleted; their standing details moved to `docs/decisions.md`.
- Closed #13 and #23; #19, #20, and #21 are folded into the v2 work (see `docs/decisions.md`).
- Before v2, measured on 2026-10-08: FreshBench v0 A questions, 7% correct with no tools and 47% with web search; vitest's ten B questions, 40% with web search and 100% with lesson drafts in the context (`docs/bench/2026-10-08/`). Caveat: one answer key (WebdriverIO, `vitest-5-0-0-6`) is known to be wrong, and it is in both the A and B sets, so the 7%/47% overall, vitest's A scores, and the ten B scores all include it. It is to be fixed against primary sources and the scores recomputed. Experiment 1: `ludion_ask` called in 20/20 runs (`docs/experiments/e1/`).

