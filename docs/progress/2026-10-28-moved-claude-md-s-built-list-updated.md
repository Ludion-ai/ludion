## 2026-10-28 (cycle 2) — CLAUDE.md's built list updated

Only CLAUDE.md's built and not-built paragraph changed (decisions: "CLAUDE.md's built and not-built list catches up"). Each added fact was checked against main at 3e2e350:

- `time-cap.ts`: `timeCap` and `sameRelease`, with its 15 minutes;
- `dependency-patch.ts`: `candidateTimeCap` for npm and Composer, with the exception's facts read for npm only;
- `osv.ts`: Packagist's advisories in Composer planning;
- docs/bench/2026-10-28-backtest-v4: 1 missed at every wait, and 157, 157, 95 and 76 unknown.

Since 3e2e350, main has merged #154 and #155. Neither changed `packages/`, `apps/` or CLAUDE.md.

No code changed. No test reads CLAUDE.md, so none was run.

The first review (fresh context) asked for changes, with two blocking findings: the judge v0 overstated as all of gate 2, and Composer's release dates. Both are fixed (decisions: the same entry). Also checked: `judge.ts` lists the code inspection under "not checked", `time-cap.ts` skips the targets and reads Packagist's `time`, and `dependency-patch.ts` re-scans the candidate for advisories.

The second review asked for changes too, with one blocking finding: "the waits" included a project's own stricter wait. Checked: `projectWait` appears only in `judge.ts`; `judge-cli.ts` does not pass it. Also checked: `osv.ts` keeps every ID OSV returns, MAL- included, so patch's re-scan stops on one. Fixed as recorded in decisions.

