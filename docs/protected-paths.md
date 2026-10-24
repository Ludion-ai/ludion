# Protected paths

PRs that change any of these paths are not auto-merged (CLAUDE.md, "Every change goes through a PR"):

- `CLAUDE.md`
- `.github/`
- `tools/verify/`
- the schema: `lessons/*.schema.json`, `packages/*/src/schema.ts`, `packages/*/schema/`, any `*.schema.json`
- `lessons/`
- `ludion.config.json`
- `wrangler.jsonc`

The required check `protected-paths` (`.github/workflows/protected-paths.yml`) fails such a PR until it carries the `review-approved` label.

## Who adds `review-approved`, and when

1. The PR author does not review their own PR. A reviewer with fresh context, someone other than the author, reads the full diff and posts the verdict as a PR comment.
2. If the verdict is "approve", the owner (or 社長 on the owner's behalf) approves the merge.
3. Only after both, whoever adds the label also posts a comment saying who reviewed, which comment holds the verdict, and who approved.

Any push to the PR removes the label automatically, so steps 1 to 3 always apply to the latest head.

## What this does and does not guarantee

Every agent pushes from the same GitHub account, and GitHub does not let an account approve its own PR, so a required "Code Owner review" would block every merge. The label is therefore a **process gate, not a technical one**: anyone with write access can add it. What the check does guarantee:

- The check's definition comes from the base branch (`pull_request_target`), so a PR cannot change it to pass itself.
- The check never checks out or runs PR code.
- A label added before the latest push does not count.
