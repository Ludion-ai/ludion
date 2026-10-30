# 2026-10-30 — Agents ran node on the host, once loading a script from the repository

- **What happened.** Agents' briefs say project commands run only in Docker. On 2026-10-30, two lanes ran `node` on the owner's PC, outside Docker, in 31 commands. Times are JST.
  - **LI (PR #221), 19:46:11, once.** A replacement script the lane had just written to its session's temporary folder. It imported only Node's file-system module (no repository code, no `node_modules`, no network). For each of six fixed strings, it checked that the string occurred once in the file it was given and replaced it; then it wrote the file back. It wrote `packages/cli/src/security/time-cap.ts` only (26 lines added, 6 removed). The lane's tests and mutations ran in Docker.
  - **LB2a (PR #215), 30 commands: 23 in its first round (15:50:16 to 16:48:44), 7 in its second and third (17:51:54 to 20:23:42).** One more, at 16:03:48, failed to parse and ran nothing.
    - **What the edit scripts loaded and wrote.** Each of the 30 ran an edit script that imported only Node's file-system module. They wrote these repository files:
      - source and tests under `packages/cli/`;
      - `action/start.sh` and `action/patch-workflow.yml`;
      - the root and `packages/cli/` READMEs and `docs/status.md`;
      - docs under `docs/bench/` and `docs/progress/`.

      They also wrote files outside the repository: the lane's PR text, report and notes.
    - **15:58:09.** After its edit script, this command ran `node --check` on the mutation script, which only parses it.
    - **15:56:44.** After its edit script, which threw before writing, this command ran `node -e` with a dynamic `import()` of the mutation script in the repository (`docs/bench/2026-10-30-lb-design/scripts/mutate.mjs`), meant to check its syntax. Importing a module runs it.
      - **What the script does.** As it then stood, it applies 57 mutations one after another: 53 to `packages/cli/src/security/deliver.ts`, and 4 to `action.yml` (2), `action/start.sh` and `action/patch-workflow.yml`. For each one it calls `npx vitest` without a shell, then writes the file back.
      - **What was seen.** The command's output was cut to its first three lines, which report three mutations as caught.
      - **What is not known:**
        - how many mutations ran after the cut;
        - whether npx started at all (on Windows, a call without a shell usually fails to find npx);
        - whether npx contacted the registry.
      - **What was checked afterwards.** The lane reported that the host had no vitest, that npx installed nothing (npx's cache had no newer entry) and that `deliver.ts` kept no mutation. A `git diff --stat` taken two minutes later shows no change left in `action.yml`.
  - **Overall.** The edit scripts loaded no dependency code. One command loaded and ran a script from the repository, which the lanes had written themselves. Other agents' temporary folders hold scripts of the same kind. Whether those ran on the host has not been checked, and a file's presence does not show that it ran.
- **Why.** The briefs' "project commands only in Docker" was read as covering builds, tests and experiments, not an agent's own edit scripts. Nothing refused `node` on the host: the Bash guard refuses the backticks bash would run, not `node`, `npm` or `npx`. Checking syntax by importing a module was a mistake in itself, because an import runs the module's top level, while `node --check` only parses.
- **What changed.** The Check is to be `.claude/hooks/guard.mjs` refusing `node`, `npm` and `npx` on the host, with its test. `.claude/` is a protected path, so that change is a protected PR the owner merges. Until it is merged, this record points to the rule below, and agents' briefs are to say: do not run node, npm or npx on the host, only inside Docker, and edit files with the editor's tools.
- **Rule:** "Never run project-controlled or downloaded code or commands on the host."
