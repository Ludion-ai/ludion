# 2026-10-29 — Ludion is a security agent; nothing is released until it is complete

**Owner, 2026-10-29 18:15 and 18:21 JST**, to the owner's Claude chat, after it had proposed cutting Ludion to the judge of npm dependency PRs (docs/mistakes/2026-10-29-the-cut-redefined-ludion.md). The owner asked whether what the chat was saying matched Ludion's goal, said what the goal is (「自動でセキュリティ更新してくれるサービス」, 「セキュリティエージェント」), said that the live site (ludion.ai) and the owner's deck describe it rightly, that finding an official release such as a new PHP version automatically is Ludion's strength, that anything published should lead with the PHP incident (CVE-2024-4577), and 「まだ完全じゃないならリリースはしない」.

## Decided

1. **The goal.** CLAUDE.md now opens with it (Goal). What Ludion is, is set by that section, the live site and the owner's deck.
2. **No release until complete,** a comments-only preview included: no npm release, no GitHub Action release, no announcement. The preview's conditions in docs/decisions/2026-10-28-release-gates-by-stage.md (L1, L9 and LP) no longer release anything. Automatic merge keeps (a) and (b) from that record, counted as fixed in docs/decisions/2026-10-29-shadow-counting.md. What "complete" means in measurable terms is fixed with the owner; docs/status.md keeps the working list of what is missing.
3. **The cut of 2026-10-29 11:29 is withdrawn.** Nothing it proposed to remove is removed. PRs #198 and #199 (the cut and its follow-ups), #200 (the site rewritten for the judge) and #201 (Japanese pages on top of #200) are closed unmerged, and their branches are kept.
4. **Carried over from the 11:29 review as rules,** because they are about how the work is recorded and done, not about what Ludion is: what is built moves out of CLAUDE.md into docs/status.md; a decision record only for a change to the goal, the scope, a gate, a wait or a rule, or one that cannot be undone; at most one open protected PR; main merged into a branch only for a conflict; text passed to a command through a file or a quoted heredoc, with the Bash guard refusing a backtick bash would run; third-party repositories read only inside a container with no credentials. The owner approves these by merging the PR that carries this record.
5. **Held for the owner, not done:** the judge's dev-only split (docs/status.md, Waiting for the owner). The proposals to give the agents their own GitHub account, CODEOWNERS and a ruleset also wait for the owner, who has to create the account.
6. **docs/design.md** stays the plan for building Ludion, but its roadmap order (the judge first) and its recommendation on where to start (「推奨は判定役から」) no longer set the direction. The owner redoes the design; a note at the top of design.md says so.

## Undo

The owner can change the goal or the release rule by editing CLAUDE.md through a protected PR. The withdrawn cut stays readable on its closed PRs.
