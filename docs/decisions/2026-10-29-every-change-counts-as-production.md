# 2026-10-29 — Every changed version counts as production; no dev-only wait

**Owner decision, 2026-10-29 about 20:55 JST**, to the owner's Claude chat, choosing 「分けない」 for "Waiting for the owner" 2 in docs/status.md: `ludion judge` and `ludion patch` both count every changed version as production.

## Why

- **The two commands disagreed.** `ludion judge` told some dependencies apart as dev-only (production.ts) and gave them the 7-day wait. `ludion patch`, once PR #203 runs the judge on its candidates, has no split and gives every change the 12-to-72-hour wait.
- **The split's errors cost the wrong thing.** The noise measurement's miss gate was not met on any sample (docs/bench/2026-10-28-noise-v2, docs/bench/2026-10-29-l1c): some dependencies the split called dev-only do ship. A shipped dependency called dev-only gets its security fix 7 days late, which is exposure time.
- **The 72-hour wait already covers most of what the longer wait was for.** Most malicious releases were removed within hours to a day (docs/design.md, 問題の定義: most of the chalk and debug releases within an hour, duckdb in 7 to 9 hours).

## Decided

1. Gate 1 tells no dependency apart as dev-only. The lockfile's `dev` flag is not used, and `ludion judge`'s `--source` option, which fed the split, is removed.
2. The wait table loses its dev-only row (7 days, weekly). The other rows are unchanged: exploited 12h (24h without comparable provenance), high 24h, normal 72h.
3. production.ts and its tests are removed. main before this change, 6e38f1f, keeps them. Bench scripts that imported it (docs/bench/2026-10-28-noise-v2, 2026-10-29-l1-count-breakdown, 2026-10-29-l1c) run at their recorded commits, not at main. tools/backtest/src/noise.ts stays: it does not use the split.
4. CLAUDE.md's gate 1 and wait table say this.
5. judge.ts keeps its `low` urgency (168h) for an input marked dev, as a pure function. No caller marks one: `ludion judge` now passes every change as production, and the backtests and the shadow already did. The 168h that rules 1 and 2 use in `ludion patch` for a new dependency's age is a different threshold and does not change.

## Undo

Bring production.ts back from 6e38f1f through a protected PR, with the dev-only row and a decision record. The suggestion carried from the review of 2026-10-29 still holds: observe what ships (the production image's node_modules, a bundle's source map) rather than infer it from configuration files.
