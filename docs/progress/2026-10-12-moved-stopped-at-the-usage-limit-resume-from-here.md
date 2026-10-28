### 2026-10-12: Stopped at the usage limit (resume from here)

- `seed-pipeline` branch (pushed, no PR yet): `tools/seed` (collect, triage, draft, check, review, revise, lessons, ci, fix, bench, watch, score, questions, calibrate), `.github/workflows/seed-watch.yml` (to split into its own protected PR), bench projects for zod, tailwindcss, ai. Run data in `docs/bench/2026-10-12-seed/` (agents: drafted, checked, reviewed, revise round 1 partly done; vitest and wrangler drafts partly done) and `docs/bench/2026-10-12-subjects/` (20 candidates triaged and scored; new subjects chosen: ai, tailwindcss, zod; their drafting just started).
- Reviewer calibration on the 30 accepted seeds: `docs/bench/2026-10-12-seed/calibrate-hand-seeds.json`. Some findings may be real problems in lessons on main (rules 3 and 8); read them.
- `exp3-unrelated` branch: harness and pool committed; the run was stopped early. Rerun `bash C:/dev/ludion-seedwork/exp3.sh` (it resumes per condition only when a condition's answers file is missing; delete a partial one first).
- Background drafting was killed; the pipeline resumes from its files, but delete any `drafts/*.json` record whose `error` mentions a limit before rerunning `draft`.
- Open: #54 (issue form, needs owner), #59, #60, #62 (C batch). Outreach drafts are in worktree `C:/dev/ludion-wt-outreach` (branch `outreach`, not pushed).
- Next: finish drafts → check → review/revise → lessons → one PR per subject (needs-owner) → ci/fix → bench; summary numbers into `docs/bench/2026-10-12-seed/README.md`; experiment 3; C batch day 2; npm stage last.

