# 2026-10-29 — `core.fsmonitor=false` ran a program named `false` on older Git

- **What happened.** The per-fix branch code (`packages/cli/src/security/branch.ts`, PR #204) passed `-c core.fsmonitor=false` on every Git call, to keep a repository's fsmonitor from running.
  - Before Git 2.36, `core.fsmonitor` is a hook path, not a boolean, so Git ran a program named `false`, found on PATH, in the project's work tree, at every index read.
  - With "." on PATH, a `false` that the project commits ran on Git 2.30.6 and 2.34.1. Debian 11 ships 2.30 and Ubuntu 22.04 ships 2.34.
  - The fresh-context review of 4bbec01 (PR #204, comment 6496973682) found it. Nothing ran on a project.
- **Why.**
  - The setting was written from the current documentation and tested only on Git 2.39.5, the version in CI and the Docker image. The PR never looked at how older Git reads the setting.
- **Check:** `packages/cli/test/branch.test.ts`, "turns fsmonitor off with an empty value": the settings hold `core.fsmonitor=` and no other value. The empty value is off on every version probed (docs/bench/2026-10-29-la-per-fix-apply/logs/fsmonitor-probe.log: 2.30.6, 2.34.1, 2.39.5).
- **Rule:** "Never run project-controlled or downloaded code or commands on the host."
