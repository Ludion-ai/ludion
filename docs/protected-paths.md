# Protected paths

A PR that changes any of these needs a fresh-context review and the owner's merge (CLAUDE.md, "Every change goes through a PR"). .github/CODEOWNERS names the owner for the same list.

- agent instructions: `CLAUDE.md` and `AGENTS.md` at any depth, `.cursorrules`, `.claude/`, `.cursor/`
- `CODEOWNERS` at any depth
- `.github/`
- the GitHub Action users run with a `pull-requests: write` token: `action.yml` and `action/`
- the schema: `packages/*/src/schema.ts`, `packages/*/schema/`, any `*.schema.json`
- `ludion.config.json`, `wrangler.jsonc`
- this file, `docs/protected-paths.md`

Dependency files (`package.json`, lockfiles) outside the paths above are not protected paths, so this check does not block dependency updates. Agents still never merge, or enable auto-merge on, a dependency-update PR (Dependabot, Renovate and the like), whatever its checks say, nor any PR an agent did not open (CLAUDE.md, "Every change goes through a PR").

## Who approves

The owner works from the account Ludion-ai, which owns the repositories. The agents work from their own account, a collaborator that can write but not administer, so it can neither approve for the owner nor change the rules below.

### The ruleset on main (the owner sets it, after the agents have moved to their own account)

Settings → Rules → Rulesets → New ruleset → New branch ruleset:

- **Name:** `main`. **Enforcement status:** Active. **Bypass list:** empty.
- **Target branches:** Include default branch.
- **Rules:**
  - Restrict deletions.
  - Block force pushes.
  - Require a pull request before merging, with:
    - Required approvals: 0;
    - Dismiss stale pull request approvals when new commits are pushed;
    - Require review from Code Owners;
    - Require approval of the most recent reviewable push.

    If GitHub asks for at least one approval to require Code Owners, set 1. The owner then approves every PR, which they merge anyway.
  - Require status checks to pass: `test` (and `protected-paths` while that check exists).

Before the agents have their own account, do not turn this on. Every PR is still opened by Ludion-ai, and GitHub does not let an account approve its own PR, so nothing could be merged.

With the ruleset on, a protected PR merges only after the owner's account approves its latest push. A push after the approval dismisses it. The `review-approved` label and the `reviewed-sha` check below then become redundant, and a later protected PR removes them.

### Until then: the protected-paths check

The required check `protected-paths` (`.github/workflows/protected-paths.yml`) fails such a PR until **both** are true for the PR's current head:

- the PR has the `review-approved` label, and
- the latest PR comment with a line `reviewed-sha: <full 40-character head SHA>` approves. A comment approves when its first line has the word `APPROVE` and not `REQUEST`. So a review that does not approve the current head, posted after one that did, fails the check again.

1. A reviewer other than the author, with fresh context, reads the full diff at the current head and posts the review as a PR comment. Its first line states the verdict (`APPROVE` or `REQUEST CHANGES`), and its last line is `reviewed-sha: <head SHA it reviewed>`.
2. The owner adds the `review-approved` label when merging.

Any push changes the head SHA, so an earlier `reviewed-sha:` stops counting by itself. Comments do not start the check, so after posting the new `reviewed-sha:` line, re-run the failed `protected-paths` run (or remove and re-add the label).

This check is a **process gate, not a technical one**: anyone with write access can add the label or the comment. What it does guarantee:

- The check's definition comes from the base branch (`pull_request_target`), so a PR cannot change it to pass itself.
- The check never checks out or runs PR code, and its token can only read.
- An approval written for an older head never counts for a newer one, and a later review of the same head that does not approve undoes it.

## Every review is recorded on its PR

Every review, of a protected PR or not and whatever its verdict, is posted as a comment on that PR and ends with the line `reviewed-sha: <the head SHA it reviewed>`. A review made after a merge is posted on the merged PR. A review with no such comment on GitHub is never reported as a review. For a PR that touches no protected path, a later review may cover only what changed since the last one, when it says so; a protected PR's review always reads the full diff at the current head, as above.
