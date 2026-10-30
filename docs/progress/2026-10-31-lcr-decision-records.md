# 2026-10-31 (LCR) — decision records only: counts, same-tag rebuilds, gate 3 for official images, the share protected, units of independence and of exposure time, the scheduled run

Started from main 47a21a9. Records only: no code, no test, no workflow, and neither CLAUDE.md nor docs/status.md changes. The gates' numbers and the wait table are unchanged.

- **Added** seven files in docs/decisions/, one per decision or proposal, each citing the private board's comment id (ludion-ops#1):
  - 2026-10-31-counts-instead-of-days.md (comment 6525272283, decision 1; the owner's 「1〜4OK」);
  - 2026-10-31-same-tag-rebuilds-in-scope.md (6525272283, decision 2);
  - 2026-10-31-gate-3-official-image-same-series.md (6525272283, decision 3; a proposal waiting for the owner's OK on its scope sentence, 6531046171, 1);
  - 2026-10-31-share-protected-without-a-person.md (6525272283, decision 4);
  - 2026-10-31-independent-unit-of-counts.md (6528291928, 3; the first audit's finding 2, 6527803283);
  - 2026-10-31-exposure-time-per-project-advisory.md (6529705640, "監査の指摘2"; the second audit's finding 2, 6529106910);
  - 2026-10-31-scheduled-run-hourly.md (6528291928, 4; the first audit's finding 6; rewritten from 6534448385, 2, after the fifth audit's finding 1, 6533867423, which measured that the schedule does not fire every time).
- **Not yet in effect, because CLAUDE.md wins until changed:** counts in place of condition (b)'s four weeks, and gate 3 for official images. Both wait for LC0, a protected PR the owner merges. Gate 3 for official images also waits for the owner's OK on its scope sentence, since an OK to a list does not approve a scope change inside it (comment 6531046171, 1).
- **Added after the PR was opened** (comment 6531046171, 1 and 2): the two notes above on when decisions 1 and 3 take effect, and, in the exposure-time record, the denominator, right-censoring with a Kaplan–Meier median, and pairs with no fix in the same major. Then (comment 6533365853, 6): the corrected "median > t" condition, the fixed window with pairs open at its start, the censoring time, when a version is judged usable, and pairs decided by OSV matching rather than by Ludion's own judgement. Then (comment 6534448385, 2, and the review of this PR in comment 6534361203): the hourly record rewritten from the audit's measurements (the shadow's schedule fired in 5 of 34 hourly slots; a private trial repository's in 0 of 4), with two triggers, the time since the previous run, and q measured rather than estimated; the slots that did not fire as part of the exposure-time and lateness results; and, in the exposure-time record, the two ways to fix when a version is usable, OSV's answer at the first detection, and the denominator under delayed entry. p0 and the wait table are unchanged.
- **Checked:** a fresh-context subagent compared the records with the board's text, looking for overstatement, additions and omissions; its findings were applied before the PR. tools/records/test/records.test.ts in Docker (node:24, `--network none` after `npm ci --ignore-scripts`): 8 passed.
- **Not done.** Nothing was released or merged.
