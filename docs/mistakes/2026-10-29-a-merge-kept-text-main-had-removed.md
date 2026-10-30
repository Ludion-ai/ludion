# 2026-10-29 — Merging main into a lane kept status text that main had just removed

- **What happened.** PR #204 (LA) conflicted with main's #205 in one long line of docs/status.md. The resolution (bfa856f) kept the lane's version of the line and applied only one of #205's edits to it. Three spans that #205 had removed came back: the production/dev split with `--source`, "the waits of the design's wait table (not its weekly batching)", and "(judge.yml, with no `--source`)". `--source` no longer exists, and the owner had decided that every change counts as production. The fresh-context review of 530a2b7 (PR #204, comment 6499134702) found it before any merge.
- **Why.**
  - The resolution started from the lane's text and patched main's changes in by hand, reading a word diff of a 4,000-character line. It should have started from main's text and reapplied the lane's own changes.
  - Nothing compared the result with main.
- **Check:** `docs/bench/2026-10-29-la-per-fix-apply/scripts/status-merge.mjs` — run with the base, the lane's and main's versions of the line, it rebuilds the line from main's text with the lane's own changes, and fails unless removing those changes gives back main's text exactly.
- **Rule:** "docs/status.md holds what is built, what is missing and what waits for the owner; a PR that changes what Ludion does updates it in the same PR."
