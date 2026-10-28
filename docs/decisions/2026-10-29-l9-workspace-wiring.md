# 2026-10-29 (night v2, L9) — The workspace package.json rule wired into `ludion judge`

The rule and the definitions are docs/decisions/2026-10-29-l9-workspace-package-json.md (fixed in 05b6b7d, 2026-10-28, before any re-judgement). Nothing there is changed, and neither is the wait table or any gate criterion. This file records how the wiring reads the rule.

- **Where.** judge-cli.ts reads each changed `<dir>/package.json` in `--files` (other than the root's) from `--before` and `--after`, and calls `workspaceManifestChanges` with both root manifests and both lockfiles' `packages`. judge.ts takes the result as `workspaces`.
- **An agreeing file** (no reasons) leaves gate 4's changed-files stop. One gate 4 info line names the agreeing files. Only files that `--files` lists count.
- **A file that does not agree** stays in the changed-files stop, and each reason is a gate 4 stop of its own. The definitions allow no correct stop to disappear; these added stops explain the old one.
- **A file that cannot be read on a side** (missing, a symlink, not a regular file, over 64 MiB) is undecidable: a gate 4 stop and verdict `undecidable`, and the file stays in the changed-files stop. The judge cannot tell a side that the caller did not pass from one that the commit does not have, so a workspace added or removed by the change is undecidable too, not agreeing.
- **A path that is not a plain workspace folder** is not read at all; the rule's first reason is given.
- **A file that is not valid JSON** is read as missing content: rule 3's reason (not a JSON object on both sides), a stop.
- **pnpm** is unchanged: no workspace file is read, and the changed-files stop stays.
- **After the review of #174** (comment 6473296446, at 90401ed: approved, nothing blocking). Two findings tighten the rule, and neither loosens it:
  - rule 2 counts only the lockfile's own entries (`Object.hasOwn`): a folder named `__proto__` was otherwise "recorded" by `Object.prototype`;
  - in rule 1, a `*` does not match a segment that starts with a dot (npm's workspace globs skip dot folders); a literal entry still does.
- **`overrides` in a workspace.** The definitions say it stops. The code stops when it changes: an unchanged one changes nothing npm installs, because npm reads overrides only at the root. The definitions are not edited.
- **Callers.** judge.yml and action/read.sh copy only the root manifest and lockfile on main today. Until LP-rest (#185) copies the changed `*/package.json` files, this judge, run by judge.yml, finds the workspace file unreadable. The verdict on a PR like #161 becomes `undecidable` instead of `stop`; neither passes. #185 copies each changed `*/package.json` on each side whose commit has it, which is what this wiring reads.
