## 2026-10-28 (cycle 2) — The judge on this repository's PRs

Added `.github/workflows/judge.yml`, `.github/workflows/judge-comment.yml`, `.github/judge/record.ts` and `packages/cli/test/judge-workflow.test.ts` (16 tests). Decisions: "The judge on this repository".

Checked in Docker (node:24-slim with jq 1.6; `npm ci` with network, then no network, read-only root, non-root):

- Typecheck passes. Packages tests: 226 passed (210 before, plus the 16 new ones). `apps/site/test/knowledge.test.ts` does not load there because the image has no git; CI runs it.
- Each of 14 single breaks makes at least one of the 16 tests fail, and all pass again once it is undone. The breaks: a write permission in either job; a checkout or npm in the comment job; the run-head check removed; extra keys accepted by the schema; the judge's text not indented; the judge built from the PR head; install scripts allowed; an action pinned by tag; the upload skipped after a failure; and a timeout, a mismatched exit code or unparseable output recorded as anything but undecidable.
- End to end on this repository's lockfile, with npm's lockfile-only update of @types/node 24.19.1 → 24.19.2 as the PR: the record script ran the built judge in 1.094 s, with the verdict "ready except build". judge-comment.yml's schema accepted the record, and its comment rendered.
- A change to `packages/cli/package.json` alone (no lockfile change) was recorded as undecidable.
- actionlint 1.7.12 (Docker, with shellcheck): 0 errors in the two new workflows. `publish.yml` has one existing info-level shellcheck note (SC2016), not changed here.

Not run: judge-comment.yml on GitHub, since `workflow_run` runs only from the default branch.

CI at 141d38e: `test` passed (vitest 281 passed; Playwright and axe 30 passed and 1 skipped).

The first review asked for changes (decisions, "The judge on this repository"). After the fixes, checked the same way in Docker:

- typecheck passes;
- packages tests: 229 passed, with the workflow tests at 19;
- each of 26 single breaks makes at least one test fail: the 14 above, and 12 for the fixes (the refusal removed, its pattern or its 300-file limit changed, the PR's file list used instead of the compare API, the head repository check removed, a SHA with a final newline accepted, the indentation left out of the text limit, a zero-width character kept, a missing record passed quietly, no overwrite on a re-run, the text not cut, and comma file names passed through);
- the end-to-end run again judged @types/node 24.19.1 → 24.19.2 "ready except build", in 0.918 s;
- actionlint: 0 errors in the two workflows.

The second review asked for changes: the event's base SHA goes stale (decisions). After the fix (386f802), checked in Docker:

- typecheck passes;
- packages tests: 230 passed, with the workflow tests at 20;
- each of 34 single breaks makes at least one test fail. These are the 26 above, with two rewritten for the changed lines, and 8 new ones:
  - the before files, the file list or the build taken from the event's base;
  - the base-branch check removed;
  - the record naming the event's base;
  - 39 hex digits plus a newline accepted as a SHA;
  - PRs into other branches commented;
  - tag characters kept.
- actionlint: 0 errors in the two workflows.

On GitHub, through the throwaway draft PR #159 (base `ci/judge-dogfood`; npm's lockfile-only update of @types/node 24.19.1 → 24.19.2), judge.yml ran from that PR's merge commit:

- Run 40665174013, at head 13a361d: the job succeeded, 09:33:36–09:33:54 UTC.
  - The record: `ready_except_build`, base 386f802 (the merge commit's first parent), judge 0.577 s, 12.781 s since the job started.
  - In Docker, judge-comment.yml's schema accepted the downloaded record, and its comment rendered.
- Then `ci/judge-dogfood` moved to 570add8, and an empty commit went to #159. Run 40665447810, at head baf6d37: the job succeeded, 09:35:41–09:36:00 UTC.
  - The PR's stored base SHA was still 386f802. The record's base was 570add8, the merge commit's first parent, so the stale-base case is judged.
  - The record: `ready_except_build`, judge 0.701 s, 12.366 s since the job started.
  - The schema accepted it.
- #159 was then closed without merging, and its branch deleted.
- judge-comment.yml has still not run on GitHub.

