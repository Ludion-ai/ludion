### 2026-10-12 (later): stopped at the usage limit again; resume here

- Done since the last note: spending rules (PR "Write the spending rules and the next steps"), pipeline defaults to Sonnet, duplicate check against lessons on main (`lessons` step writes `duplicates.json`), new-subject drafting stopped (zod 25 and tailwindcss 15 drafted, ai none; kept in `docs/bench/2026-10-12-subjects/`), vitest reviewed once (round 0: 34 drafts, 24 passed the local checks, 54 review findings; no further rounds, per the rules).
- wrangler drafting: 31 drafted and 1 skipped saved; 24 runs ended on the usage limit and their error records were removed. Resume: `node tools/seed/src/cli.ts draft docs/bench/2026-10-12-seed/wrangler --kinds default,behavior,deprecated,renamed,removed --signal silent`, then `check`, `review`, `lessons` (one round of `revise` at most) and `summary` on that folder.
- Next step 1 is still open: write `docs/bench/2026-10-12-seed/README.md` comparing candidates → passed local checks → review findings → CI for agents (summary.json exists; PR #62 is the CI run, 6 of 6 passed Docker), vitest and wrangler, against the hand-made seeds (`calibrate-hand-seeds.json`: 46 findings on 30 accepted lessons; reviewer was Opus there). Models differed across runs (agents and vitest Opus, wrangler partly Sonnet); say so in the README.
- Open PRs: #54 (issue form, owner), #60 (consent draft), #62 (6 agents lessons, owner; test re-run on the merged branch is pending in CI), #66 (outreach, auto-merge), the spending-rules docs PR (auto-merge). `seed-pipeline` has no PR yet.


