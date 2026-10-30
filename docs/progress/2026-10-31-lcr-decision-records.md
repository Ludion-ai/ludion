# 2026-10-31 (LCR) — decision records only: counts, same-tag rebuilds, gate 3 for official images, the share protected, units of independence and of exposure time, the hourly run

Started from main 47a21a9. Records only: no code, no test, no workflow, and neither CLAUDE.md nor docs/status.md changes. The gates' numbers and the wait table are unchanged.

- **Added** seven files in docs/decisions/, one per decision, each citing the private board's comment id (ludion-ops#1):
  - 2026-10-31-counts-instead-of-days.md (comment 6525272283, decision 1; the owner's 「1〜4OK」);
  - 2026-10-31-same-tag-rebuilds-in-scope.md (6525272283, decision 2);
  - 2026-10-31-gate-3-official-image-same-series.md (6525272283, decision 3);
  - 2026-10-31-share-protected-without-a-person.md (6525272283, decision 4);
  - 2026-10-31-independent-unit-of-counts.md (6528291928, 3; the first audit's finding 2, 6527803283);
  - 2026-10-31-exposure-time-per-project-advisory.md (6529705640, "監査の指摘2"; the second audit's finding 2, 6529106910);
  - 2026-10-31-scheduled-run-hourly.md (6528291928, 4; the first audit's finding 6).
- **Not yet in effect, because CLAUDE.md wins until changed:** counts in place of condition (b)'s four weeks, and gate 3 for official images. Both wait for LC0, a protected PR the owner merges.
- **Checked:** a fresh-context subagent compared the records with the board's text, looking for overstatement, additions and omissions; its findings were applied before the PR. tools/records/test/records.test.ts in Docker (node:24, `--network none` after `npm ci --ignore-scripts`): 8 passed.
- **Not done.** Nothing was released or merged.
