# 2026-10-30 (LV5) — A smallest fixed version with an OSV MAL- record stops the fix

Started from main 3384a53. Detail: docs/bench/2026-10-30-lv5-mal-smallest-stops. The gates' numbers and the wait table are unchanged.

- **Decision first**: docs/decisions/2026-10-30-mal-smallest-stops-the-fix.md (the owner's decision of 17:54 JST, 「1.OK」), committed at 5a3e7b2 before the code. It overrides docs/decisions/2026-10-30-next-fix-same-publisher.md for this case only, and that record is unchanged.
- **next-fix.ts, dependency-patch.ts**: OSV is asked about the smallest even when it is deprecated or unlisted; a MAL- record in force on it stops the fix at gate 2 before any build or test, with no later version looked at or compared. `version_choice` has `chosen: null`, every reason found and the MAL- ids (`malicious`); the fix's reason is "Gate 2 stops this fix: " and the note. Every other reason to pass over the smallest is as before.
- **Review round 1** (PR comment 6519387242, APPROVE with non-blocking findings): the first stop in a fix ends its lookups and keeps every smallest in `changes`; README and comment wording; the decision record says the two-copies rule and the OSV-failure path. The alias-only MAL- reading (finding 4) is left for a later decision.
- **Review round 2** (PR comment 6519607474, APPROVE with non-blocking findings): tests and mutations for the same two-copies rule under a publisher stop; the decision record says that rule is a lane detail and what it changed since #213, the mistakes record names it, and docs/status.md says the alias-only reading waits for a decision.
- **Documents**: docs/status.md and both READMEs; docs/mistakes/2026-10-30-next-fix-trusted-the-malware-publisher.md.
- **Checks** (Docker, on 3e4adc0): CLI tests 21 files, 889 passed, 19 skipped; CI's checks except Playwright: typecheck 0, build 0, `npm test` 34 files, 1135 passed, 19 skipped; mutations 14 of 14 caught.
- **Not done.** No live e2e (no live package has a MAL- smallest). Nothing was released or merged.
