# 2026-10-29 (L9b) — The two non-blocking findings on the workspace package.json rule, fixed

- **Task.** The owner's D (2026-10-29 09:30 JST): fix L9's two findings that did not block. They are findings 2 and 3 of the review of #174 (comment 6473524412). Decisions: docs/decisions/2026-10-29-l9b-workspace-findings.md, committed before the code (1cccdfb). Details: docs/bench/2026-10-29-l9b-workspace-findings/.
- **`!` in `workspaces`.**
  - Before: an exclusion such as `"!apps/worker"` matched nothing and excluded nothing, so the excluded folder was read as a workspace.
  - Now: if the root's `workspaces` has any entry with `!`, before or after, no folder is read as a workspace. The file stays in gate 4's changed-files stop, and the reason names the entry.
  - npm 11.19.1 reads a leading `!` as an exclusion, which was checked in its `@npmcli/map-workspaces` 5.0.3. This check does not reproduce that, so it refuses.
- **A top-level `"__proto__"`.**
  - Before: `manifestChanges` read an absent key through `Object.prototype`, so adding `"__proto__": {}` did not count as a change.
  - Now: it reads own keys only, and so does rule 5's comparison of the lockfile record. Adding, removing or changing a top-level `"__proto__"` stops, in a workspace `package.json` and in the root one.
- **Results** (Docker, offline, HEAD 1336380):
  - typecheck exit 0;
  - node tests: 790 passed and 13 skipped. The two files that need git failed without git, then passed with it (13 passed, 6 skipped), and the build exited 0;
  - workspace-manifests.test.ts: 22 tests, up from 19;
  - mutants: this lane's 9, 0 survived. L9's wiring mutants, 0 of 17 survived. L9's module mutants, 1 of 14 counted as surviving: "rule 5 off" no longer applies to the changed line, and the same mutant on the new text is among this lane's 9 and is killed.
- **Not changed.** The rule's other parts, the wait table, gate criteria, `.github/workflows/` and `action/`. #161 and #162 were not judged again.
