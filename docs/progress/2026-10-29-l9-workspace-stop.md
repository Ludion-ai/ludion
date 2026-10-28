# 2026-10-28 (cycle 3, L9) — Workspace package.json stops: rule built, not wired

Moved here unchanged from docs/progress.md, under the one-record-per-file rule (2026-10-29). First committed in efbc772 (2026-10-28 22:00:29 JST).

docs/bench/2026-10-28-l9-workspace-stop.
- **Definitions** of a false gate 4 stop were committed first (05b6b7d).
- **The module.** workspace-manifests.ts and its 8 tests. In Docker the CLI suite passed 187, with 5 skipped, and survived 0 of 14 mutations.
- **On the real files.** Run alone on #161's and #162's files, the module finds both workspace manifests agree with the lockfile.
- **Not done.** The judge does not call the module: judge.ts and judge-cli.ts are L1's, and judge.yml is protected. So #161 and #162 were not judged again, and nothing was merged.
