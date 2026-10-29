# 2026-10-29 — The per-fix branch code started git in the project's folder

- **What happened.** In PR #204 (LA), `packages/cli/src/security/branch.ts` ran the host's `git` with the project's folder as its working directory. On Windows, where the owner runs Ludion, the child's working directory is searched for `git.com` and `git.exe` before PATH. A project that ships its own `git.exe` would therefore have run it on the host at the first `rev-parse`, before any check. The fresh-context review of b572f81 (PR #204, comment 6495268563) found it, and nothing ran.
- **Why.**
  - The code closed every way the repository's Git configuration could start a command (hooks, fsmonitor, signing, filters), but not the way the program itself is found.
  - The hook test is skipped on Windows, and the Linux tests could not show a Windows-only lookup.
- **Check:** `packages/cli/test/branch.test.ts` — "never runs a git program from the project's folder": with "." on PATH, which makes Linux look in the working directory as Windows does, a `git` in the project must not run, and a control shows it does when started there. Git now starts in a temporary folder Ludion owns and is given the repository with `-C`.
- **Rule:** "Never run project-controlled or downloaded code or commands on the host."
- **Not covered.** `packages/sandbox/src/docker.ts` starts `docker` with the inherited working directory. It is a protected path, so it was left for its own PR.
