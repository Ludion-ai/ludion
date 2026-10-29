## 2026-10-28 — CLAUDE.md rewritten (cleanup PR-D)

CLAUDE.md, README wording ("An empty result is not a security guarantee", from #138's review) and the last lesson-era site copy. Local: typecheck pass; build pass; vitest 179 passed / 1 skipped; Playwright + axe 30 passed / 1 skipped.

Round 1 review of this PR (REQUEST CHANGES): CLAUDE.md read design targets as current behaviour. It now states the goal as a goal and lists what is not built yet (gate 2, waits, lockfile-diff checks, minimal candidates, exposure timestamps, apply setting), with the rule not to describe the preview as gated, waited or minimal until each lands; plus the reviewer's non-blocking clarifications. Also added from #140's review: the decisions note on which six files' final versions are only in main's history, a production check of `/index/subjects.json`, and a container-start guard that scans every `.ts/.mts/.cts/.js/.mjs/.cjs` file in the repository except unit-test folders, build output and installed packages.

