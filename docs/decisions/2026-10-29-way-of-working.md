# 2026-10-29 — The way of working: every mistake becomes a check

**Owner, 2026-10-29 18:24 JST**, stopping the code work: 「先に組み直せやり方を、そして記録更新しろ そうじゃないと間違える ニューラルネットワーク式にやったらいいじゃない？関門は全てアルゴで まぁ設計はまた後で深掘りする」

Taken as: before more code, change how the work is done and bring the records up to date; improve the way a network is trained, feeding each error back as a correction; make every checkpoint code rather than memory. Whether any of Ludion's own gates should use a learned model is left for the design deep-dive (docs/status.md, Waiting for the owner).

## Decided

1. **CLAUDE.md opens with the goal** and holds the rules only; what is built is in docs/status.md. CLAUDE.md stays under 12,000 bytes, so status cannot crowd the goal out again.
2. **Mistakes feed back.** Each mistake is a file in docs/mistakes/ with what happened, why, and at least one `**Check:**` (a file that now catches it) or `**Rule:**` (a sentence quoted from CLAUDE.md). tools/records/test/records.test.ts fails when a check's file or a rule's sentence no longer exists.
3. **A deletion is a scope change.** protected-paths.yml treats a PR that deletes a file, or renames one to a path outside all of these places, under packages/*/src/, apps/site/src/pages/, action/ (and action.yml), docs/decisions/ or docs/mistakes/ as a protected PR. records.test.ts checks that the workflow's list and CLAUDE.md's sentence name the same places.
4. **Direction comes from main.** A lane starts from main and its brief names the commit. test.yml fails a PR whose base is not main, so stacked PRs are not used.
5. **Stopping a lane** means telling the running session itself and confirming it stopped.
6. **What to work on** is what docs/status.md lists as missing for "complete", a gate, or a reported failure; anything else is proposed to the owner first.

## What these checks do not catch

- The deletion rule sees a deleted or renamed-out file, not a file emptied in place or a command taken out of a file that stays. The review and CLAUDE.md's Scope rule cover those.
- The base check stops a PR stacked on another PR's branch (as #199 and #201 were), not a lane that copies an open PR's text into a PR against main (as #200 did); the rule that direction comes from main covers that.
- records.test.ts checks that a mistake's check or rule still exists, not that it still catches the mistake.
- Every agent writes from the same GitHub account, so, like the rest of protected-paths.yml, these are process gates, not technical ones (docs/protected-paths.md).
