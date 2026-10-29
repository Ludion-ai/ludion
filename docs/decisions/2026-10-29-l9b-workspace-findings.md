# 2026-10-29 (L9b) — Two non-blocking findings on the workspace package.json rule: `!` entries and a top-level `__proto__`

The owner decided (2026-10-29 09:30 JST, D) that L9's two findings that did not block are fixed. They are findings 2 and 3 of the review of #174 (comment 6473524412, at e2e8a73). This file is committed before the code changes. Both changes only add stops; neither removes one. The rule (docs/decisions/2026-10-29-l9-workspace-package-json.md), the wait table and every gate criterion are otherwise unchanged.

## 1. A `workspaces` entry with `!`

- **Found.** Rule 1 says a `!` pattern "matches nothing". It also excluded nothing: with root `"workspaces": ["apps/*", "!apps/worker"]`, `apps/worker` was read as declared, although npm does not make it a workspace.
- **npm.** In node:24-slim (npm 11.19.1, `@npmcli/map-workspaces` 5.0.3), an entry starting with an odd number of `!` is an exclusion, an even number is the pattern without them, and a later entry can undo an earlier exclusion. This check does not reproduce that.
- **The change.** When the root's `workspaces`, before or after the change, has any string entry containing `!`, no folder is read as a workspace. The file is not taken as agreeing, and the reason names the `!` entry as something this check does not read. So gate 4's changed-files stop stays for that file.
- **Cost.** A project that uses `!` in `workspaces` gets this stop on every workspace `package.json` change, as before L9. That is a limit of the check, reported in the stop, not a pass.

## 2. A top-level `"__proto__"` key

- **Found.** `JSON.parse` makes `"__proto__"` an own key. `manifestChanges` (judge.ts) compared `b[key]` with `a[key]`, so on a side without that own key it read `Object.prototype`, which `JSON.stringify` writes as `{}`. Adding `"__proto__": {}` to a workspace `package.json` was not seen as a change. The same comparison is used for the root `package.json`.
- **The change.** `manifestChanges` reads only own keys: a key missing on one side is missing (`undefined`), not inherited. Adding, removing or changing a top-level `"__proto__"` is then a change of a field that is not a dependency list, which stops, in a workspace `package.json` and in the root one. Rule 5's comparison of the lockfile's record of the workspace reads only own keys in the same way. Nothing assigns a parsed key onto another object, so no prototype is changed.
