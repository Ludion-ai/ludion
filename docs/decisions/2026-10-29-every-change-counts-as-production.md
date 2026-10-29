# 2026-10-29 — Every changed version counts as production; no dev-only wait

**Owner decision, 2026-10-29 about 20:55 JST**, to the owner's Claude chat, choosing 「分けない」 for "Waiting for the owner" 2 in docs/status.md (as numbered at main 6e38f1f): `ludion judge` and `ludion patch` both count every changed version as production.

## Why

- **The two commands disagreed.** `ludion judge` told some dependencies apart as dev-only (production.ts) and gave them the 7-day wait. `ludion patch` has no split (docs/status.md), and the open PR #203, which makes it run the judge on its candidates, gives every change the 12-to-72-hour wait.
- **The split's errors cost the wrong thing.** The noise measurement's miss gate was not met on any sample (docs/bench/2026-10-28-noise-v2, docs/bench/2026-10-29-l1c): some dependencies the split called dev-only do ship. A shipped dependency called dev-only gets its security fix 7 days late, which is exposure time.
- **The 72-hour wait already covers most of what the longer wait was for.** Most malicious releases were removed within hours to a day (docs/design.md, 問題の定義: most of the chalk and debug releases within an hour, duckdb in 7 to 9 hours).

## Decided

1. Gate 1 tells no dependency apart as dev-only. The lockfile's `dev` flag is not used, and `ludion judge`'s `--source` option, which fed only the split, is removed with it.
2. The wait table loses its dev-only row (7 days, weekly). The other rows are unchanged: exploited 12h (24h without comparable provenance), high 24h, normal 72h.
3. production.ts and its tests are removed. main before this change, 6e38f1f, keeps them. Bench scripts that imported it (docs/bench/2026-10-28-noise-v2, 2026-10-29-l1-count-breakdown, 2026-10-29-l1c) run at their recorded commits, not at main. tools/backtest/src/noise.ts stays: it does not use production.ts (it counts with the lockfile's own `dev` flag, as its recorded runs did). The tests in production.test.ts that covered judge.ts's lockfile reader and gate 4's extraneous-folder stop move to judge.test.ts.
4. CLAUDE.md's gate 1 and wait table say this.
5. judge.ts keeps its `low` urgency (168h) for an input marked dev, as a pure function. `ludion judge` and the backtests mark none. **The shadow does:** its replay judges each captured version in four rows, one of them dev-only at 168h (tools/shadow/src/replay.ts; docs/decisions/2026-10-29-shadow-counting.md), and condition (b) is counted on all four. That count was fixed before the shadow started and this decision does not change it, so the shadow keeps judging a dev row the wait table no longer has. Whether (b)'s count should drop that row is a separate decision for the owner.
6. Rule 2's minimum age for a package new to the lockfile in `ludion patch` (168h) is a different threshold. It took its value from the dev row's constant; it now has its own (`NEW_PACKAGE_AGE_HOURS`) and does not change.

## Undo

Bring production.ts back from 6e38f1f through a protected PR, with the dev-only row and a decision record. The suggestion carried from the review of 2026-10-29 still holds: observe what ships (the production image's node_modules, a bundle's source map) rather than infer it from configuration files.
