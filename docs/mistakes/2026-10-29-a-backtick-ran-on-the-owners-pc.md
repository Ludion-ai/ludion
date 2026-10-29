# 2026-10-29 — A backtick in a double-quoted string ran a command on the owner's PC

- **What happened.** While third-party repositories were being measured on the owner's PC for the noise sample, a markdown code span inside a double-quoted shell string ran `npx webpack serve` on that PC. The same sample held a repository whose build runs an obfuscated payload.
- **Why.** Bash runs a backtick inside double quotes as a command, and text meant for a PR comment went to a command that way. Third-party repositories were read on the PC itself, not inside a container.
- **Check:** `.claude/hooks/guard.test.ts` — the Bash guard refuses a backtick that bash would run (outside single quotes and quoted heredoc bodies). It runs only in Claude Code sessions opened in this repository; a session working in another folder, such as a third-party clone, is covered only by the rules below.
- **Rule:** "Pass text (PR bodies, comments, commit messages) to a command through a file or a quoted heredoc (`<<'EOF'`), never inside double quotes, where a backtick runs as a command."
- **Rule:** "Read third-party repositories only inside a container with no credentials."
