# 2026-10-29 — The per-fix branch code left two ways for a repository's Git configuration to run a command

- **What happened.** The fresh-context review of bc60a34 (PR #204, comment 6495552957) found two ways in `packages/cli/src/security/branch.ts`. Nothing ran on a project.
  - **Config-named hooks.** Hooks named in configuration (`hook.<name>.command` with `hook.<name>.event`) are run by newer Git whatever `core.hooksPath` says. On the host's Git 2.55, the PR's exact calls ran such a `post-index-change` and `reference-transaction` hook.
  - **Lazy fetch.** In a partial clone whose HEAD commit is missing locally, `rev-parse HEAD^{commit}` fetched the commit and ran the repository's `remote.origin.uploadpack` command.
- **Why.**
  - The defences were written against the hooks, fsmonitor, signing and filters known to Git 2.39, the version in CI and the Docker image. They were not written against what a newer Git on the owner's PC reads.
  - Reading an object was not seen as a way to reach the network.
- **Check:** `packages/cli/test/branch.test.ts`. "refuses a repository whose configuration names hooks" is version-independent: any `hook.*` setting refuses before any hook-running command. "never fetches a missing object with the repository's own transport command" passes `protocol.allow=never` and `GIT_NO_LAZY_FETCH=1`, and has a control in which plain Git runs the command.
- **Rule:** "Never run project-controlled or downloaded code or commands on the host."
