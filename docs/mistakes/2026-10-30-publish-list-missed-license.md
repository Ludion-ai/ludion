# 2026-10-30 — The publish check's file list missed LICENSE

- **What happened.** packages/cli/package.json started shipping `LICENSE`, but the publish workflow's check of the packed files still expected three files. A publish would have stopped at that check. Nothing has been published since, so nothing went out wrong; the fix waited in an unopened branch from 2026-10-29 until this PR.
- **Why.** The list of files is written twice, in package.json's `files` and in publish.yml's check, and nothing compared the two.
- **Check:** `packages/cli/test/action.test.ts` — the publish workflow's list must be package.json's `files` plus package.json.
