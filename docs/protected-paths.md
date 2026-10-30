# Protected paths

PRs that change any of these paths are not auto-merged (CLAUDE.md, "Every change goes through a PR"):

- agent instructions: `CLAUDE.md` and `AGENTS.md` at any depth, `.cursorrules`, `.claude/`, `.cursor/`
- `CODEOWNERS` at any depth
- `.github/`
- `tools/verify/`
- the security commands' sandbox (Docker runner, public-address fetch and the guard on starting containers): `packages/sandbox/`
- the schema: `packages/*/src/schema.ts`, `packages/*/schema/`, any `*.schema.json`
- `lessons/`
- `ludion.config.json`, `wrangler.jsonc`
- this file, `docs/protected-paths.md`
- a file **deleted**, or renamed to a path outside all of these places, under `packages/*/src/`, `apps/site/src/pages/`, `action/` (and `action.yml`), `docs/decisions/` or `docs/mistakes/`: removing what Ludion does is a scope change, and decision and mistake records are never deleted (CLAUDE.md, How we work). A rename from one of these places to another is not caught.

Dependency files (`package.json`, lockfiles) outside the paths above are not protected paths, so this check does not block dependency updates. Instead, every new dependency is checked by security before it is added. Agents still never merge, or enable auto-merge on, a dependency-update PR (Dependabot, Renovate and the like), whatever its checks say, nor any PR an agent did not open (CLAUDE.md, "Every change goes through a PR").

The required check `protected-paths` (`.github/workflows/protected-paths.yml`) fails such a PR until **both** are true for the PR's current head:

- the PR has the `review-approved` label, and
- the latest PR comment with a line `reviewed-sha: <full 40-character head SHA>` approves. A comment approves when its first line has the word `APPROVE` and not `REQUEST`, and it has exactly one `reviewed-sha:` line (below). So a review that does not approve the current head, posted after one that did, fails the check again.

## How a protected PR gets approved

1. A reviewer other than the author, with fresh context, reads the full diff at the current head and posts the review as a PR comment. Its first line states the verdict (`APPROVE` or `REQUEST CHANGES`), and it has the line `reviewed-sha: <head SHA it reviewed>`, which need not be its last line.
2. The owner (or 社長 on the owner's behalf) approves the merge.
3. After both, the `review-approved` label is added, with a comment naming the reviewer, the verdict comment, and who approved.

Any push changes the head SHA, so an earlier `reviewed-sha:` stops counting by itself. Steps 1 and 2 must be repeated for the new head; the label can stay, since only an approval in the latest review of the current head passes the check. Comments do not start the check, so after posting the new `reviewed-sha:` line, re-run the failed `protected-paths` run (or remove and re-add the label).

## Every review is recorded on its PR

Every review, of a protected PR or not and whatever its verdict, is posted as a comment on that PR and has the line `reviewed-sha: <the head SHA it reviewed>`. That line is, in full, `reviewed-sha:`, one space and the 40-character SHA in lowercase, with nothing before or after it; a line in any other form is not counted. A comment with exactly one such line is a review of the head it names. A comment with two or more, as when it quotes another review's line, is not counted as a review: it approves nothing, and it undoes an earlier approval of each head it names. A review made after a merge is posted on the merged PR. A review with no such comment on GitHub is never reported as a review. For a PR that touches no protected path, a later review may cover only what changed since the last one, when it says so; a protected PR's review always reads the full diff at the current head, as above.

## What this does and does not guarantee

Every agent pushes from the same GitHub account, and GitHub does not let an account approve its own PR, so a required "Code Owner review" would block every merge. This check is therefore a **process gate, not a technical one**: anyone with write access can add the label or the comment. What it does guarantee:

- The check's definition comes from the base branch (`pull_request_target`), so a PR cannot change it to pass itself.
- The check never checks out or runs PR code, and its token can only read.
- An approval written for an older head never counts for a newer one, and a later review of the same head that does not approve undoes it.

The rule on deleted files sees a file deleted or renamed out, not a file emptied in place or a command taken out of a file that stays; the review and CLAUDE.md's Scope rule cover those.
