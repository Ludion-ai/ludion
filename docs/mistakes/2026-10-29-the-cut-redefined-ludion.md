# 2026-10-29 — A simplification redefined what Ludion is

- **What happened.** The owner asked the Claude chat to rethink Ludion by removing what it does not need. The chat proposed cutting Ludion to the judge of npm dependency PRs: removing the fixer (`init`, `scan`, `patch`, `watch`), PHP Docker, Composer, Maven, the read-only scans and packages/sandbox, and releasing a comments-only preview. The owner answered 「全て推奨で行く」 to the list (11:29 JST). #198 carried the cut and passed a fresh-context review; #200 rewrote the site for the judge and #201 added Japanese pages on top of it. At 18:15 the owner pointed out that this was not Ludion: the goal is a service that applies security updates automatically, and the live site and deck were right. Nothing was merged. About seven hours of work, the chat's and Grok's lanes', went in the wrong direction.
- **Why.**
  1. The records pointed at the judge. CLAUDE.md opened with a 4,500-byte status paragraph, and its release conditions were all about the judge's comments-only preview; docs/design.md's roadmap put the judge first. The goal sentence was there, but the text around it made "release" mean the judge.
  2. "What is not needed" was measured against what the release path used, not against what Ludion is for, so code the judge did not call was counted as unused.
  3. The owner approved a list. The list named files and parts, not the consequence (Ludion would no longer update PHP), so the OK never covered the sentence that mattered.
  4. A fresh-context review checks a diff against the rules in the repository. With the rules pointing the same way, it approved.
  5. Lanes started from an open PR: #200 and #201 were built on #198's text before it was merged.
- **Check:** `.github/workflows/protected-paths.yml` — a PR that deletes a file under packages/*/src/, apps/site/src/pages/, action/, docs/decisions/ or docs/mistakes/ is protected: fresh-context review and the owner's merge.
- **Check:** `tools/records/test/records.test.ts` — CLAUDE.md opens with the goal and stays under 12,000 bytes, and the deletion rule names the same places in CLAUDE.md and in the workflow.
- **Check:** `.github/workflows/test.yml` — a PR whose base is not main fails, so no PR can be stacked on another PR's branch, as #199 and #201 were. It would not have stopped #200, which targeted main with #198's text; the last rule below covers that.
- **Rule:** "Until Ludion does what this section says, for everything it claims to support, through all four gates, nothing is released: no npm release, no GitHub Action release and no announcement, a comments-only preview included."
- **Rule:** "Removing or narrowing what Ludion does (an ecosystem, a command, a gate, a page of the site) is a scope change."
- **Rule:** "Before it, write one sentence saying what Ludion will no longer do, and get the owner's OK on that sentence; an OK to a list does not approve a scope change inside it."
- **Rule:** "Never start one from an open PR's text or a decision that is not merged."
