# 2026-10-30 (LV5) — A smallest fixed version with an OSV MAL- record stops the fix

Started from main 3384a53. Detail: docs/bench/2026-10-30-lv5-mal-smallest-stops. The gates' numbers and the wait table are unchanged.

- **Decision first**: docs/decisions/2026-10-30-mal-smallest-stops-the-fix.md (the owner's decision of 17:54 JST, 「1.OK」), committed at 5a3e7b2 before the code. It overrides docs/decisions/2026-10-30-next-fix-same-publisher.md for this case only, and that record is unchanged.
- **next-fix.ts, dependency-patch.ts**: OSV is asked about the smallest even when it is deprecated or unlisted; a MAL- record in force on it stops the fix at gate 2 before any build or test, with no later version looked at or compared. `version_choice` has `chosen: null`, every reason found and the MAL- ids (`malicious`); the fix's reason is "Gate 2 stops this fix: " and the note. Every other reason to pass over the smallest is as before.
- **Documents**: docs/status.md and both READMEs; docs/mistakes/2026-10-30-next-fix-trusted-the-malware-publisher.md.
- **Checks** (Docker, on e150e3a): CLI tests 21 files, 881 passed, 19 skipped; CI's checks except Playwright: typecheck 0, build 0, `npm test` 34 files, 1127 passed, 19 skipped; mutations 10 of 10 caught.
- **Not done.** No live e2e (no live package has a MAL- smallest). Nothing was released or merged.
