## 2026-10-28 — The time cap, and backtest v3

The owner kept the wait table and asked for the dependencies that move with a fix to be capped at the fix's publish time T (decisions: "Moving dependencies are capped at the fix's publish time").

- **#147** fixed the rules and backtest v3's definitions before any v3 code ran (bd0bc02, 14:10 JST).
- **#148** implements them:
  - Rule 1: a version published at or after T that was not already locked stops the change.
  - Rule 2: a new dependency younger than the base wait at T stops it.
  - Rule 3: the comment always shows the count of versions published at or after T.
  - Coverage: `ludion judge` (npm, and pnpm as a version set that is never ready), and `ludion patch` candidates (npm, and Composer with Packagist's author-set release times).
  - Checked in Docker: typecheck passed and 184 package tests passed.

**Backtest v3** (`tools/backtest/src/malicious-v3.ts`, `fixes-v3.ts`; results and raw data in docs/bench/2026-10-28-backtest-v3/):

- Every one of the 5,398 npm GHSA fixes published after a malicious version had its tree resolved as of its own T.
- 7 of the 1,148 malicious versions are ever selected by such a fix:
  - one is missed at every wait: @ensdomains/buffer 0.1.1, published 2023 and named by a 2025 record;
  - six are caught by the re-query.
- Unknown is 156 at 12h/24h, 93 at 72h and 76 at 168h. In each, a fix in the version's window resolves through a branch the registry no longer serves.
- Stopped: 991 at 12h/24h, 1,054 at 72h, 1,071 at 168h (rerun: 928, 1,044, 1,070).
- Gate 2 signals are unverified for the 1,140 removed versions. deps.dev has none of them, only 1,016 of their predecessors.
- Genuine fixes: 49 of 200 are stopped (rerun: 35).
  - 29 are stopped by rule 1, 14 of them by nothing else. These are monorepo siblings published after the fixed package, for example next and `@next/env` 5–11 seconds later.
  - The median added delay is unchanged: exploited 16.4h (n = 5), high 0h (n = 19), normal 41.5h (n = 127).
- A script bug that made removed versions unselectable was found in the first execution and corrected before the write-up. The definitions are unchanged.

Gate: **not met** (1 missed and the unknowns, at every wait). The delay gates are met. The wait table is unchanged.

