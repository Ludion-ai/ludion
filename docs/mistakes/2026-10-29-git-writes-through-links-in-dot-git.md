# 2026-10-29 — Ludion's Git could write outside the repository through links inside .git

- **What happened.** The review of 9e29738 (PR #204, comment 6497373214) probed Git 2.30 to 2.54 and found that a project could point paths inside its own `.git` folder elsewhere. Nothing ran on a project.
  - If `.git/refs/heads/ludion` is a symbolic link to `../tags`, the fix branch becomes a tag.
  - If it points to a folder outside the repository, Git creates the ref there.
  - If the reflog path of the predictable branch name links to a host file, Git appends a line to that file.
  - If an `objects/<xx>` folder links outside, Git writes the object there.
  - No command ran and the content was fixed, but the project chose a host file outside the project for Ludion to change.
- **Why.**
  - The checks covered what Git runs (hooks, transports, filters), not where Git writes.
  - Git trusts the layout of its own `.git` folder, and this project's `.git` folder is project-controlled data.
- **Check:** `packages/cli/test/branch.test.ts` — "refuses a symbolic link inside .git where Git would write, and a reflog the branch already has". It has a control in which plain Git follows the link.
- **Rule:** "Never run project-controlled or downloaded code or commands on the host."
