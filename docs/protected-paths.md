# Protected paths

PRs that change any of these paths are not auto-merged (CLAUDE.md, "Every change goes through a PR"):

- agent instructions: `CLAUDE.md` and `AGENTS.md` at any depth, `.cursorrules`, `.claude/`, `.cursor/`
- `CODEOWNERS` at any depth
- `.github/`
- `tools/verify/`
- the security commands' Docker sandbox: `packages/cli/src/security/docker.ts`
- the schema: `packages/*/src/schema.ts`, `packages/*/schema/`, any `*.schema.json`
- `lessons/`
- `ludion.config.json`, `wrangler.jsonc`
- this file, `docs/protected-paths.md`

Dependency files (`package.json`, lockfiles) are not protected paths, so dependency updates are not blocked. Instead, every new dependency is checked by security before it is added.

The required check `protected-paths` (`.github/workflows/protected-paths.yml`) fails such a PR until **both** are true for the PR's current head:

- the PR has the `review-approved` label, and
- a PR comment contains a line `reviewed-sha: <full 40-character head SHA>`.

## How a protected PR gets approved

1. A reviewer other than the author, with fresh context, reads the full diff at the current head and posts the verdict as a PR comment. An approving verdict ends with the line `reviewed-sha: <head SHA it reviewed>`.
2. The owner (or 社長 on the owner's behalf) approves the merge.
3. After both, the `review-approved` label is added, with a comment naming the reviewer, the verdict comment, and who approved.

Any push changes the head SHA, so an earlier `reviewed-sha:` stops counting by itself. Steps 1 and 2 must be repeated for the new head; the label can stay. Comments do not start the check, so after posting the new `reviewed-sha:` line, re-run the failed `protected-paths` run (or remove and re-add the label).

## What this does and does not guarantee

Every agent pushes from the same GitHub account, and GitHub does not let an account approve its own PR, so a required "Code Owner review" would block every merge. This check is therefore a **process gate, not a technical one**: anyone with write access can add the label or the comment. What it does guarantee:

- The check's definition comes from the base branch (`pull_request_target`), so a PR cannot change it to pass itself.
- The check never checks out or runs PR code, and its token can only read.
- An approval written for an older head never counts for a newer one.
