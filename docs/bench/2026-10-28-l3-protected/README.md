# Cycle 3, the protected PR: two rules, and the follow-ups to #156, #157 and #158's reviews

The detailed record of PR #166 (branch `ci/cycle3-followups`). docs/decisions.md and docs/progress.md carry only a short summary at their end, which points here.

## Decisions

The owner chose E1 and E2 (cycle 3). One protected PR (#166) carries both rules and the non-blocking findings of #156 (N1–N7) and #158 (N1–N8), and #157's findings 5 and 6. The earlier entries are left as they were written and reviewed; where this entry corrects one, it says so. The two Dependabot entries were moved, unchanged, next to the judge's (#157's finding 5).

The rules, now in CLAUDE.md ("Every change goes through a PR") and docs/protected-paths.md:

- **Every review is recorded on its PR** (E1). Every review, protected path or not, is posted as a comment on its PR ending `reviewed-sha: <the head SHA reviewed>`, and a review with no such record on GitHub is never reported as a review. decisions.md's entry "Every review is recorded on its PR" left writing this into the two protected files to the owner.
- **Agents never merge a dependency-update PR** (E2): Dependabot, Renovate and the like, whatever CI says. CLAUDE.md's "Other PRs may auto-merge only with green CI" covered them before (#157's review, finding 1). The same sentence carries E2's other half, in force since the cycle 3 instructions: agents merge no PR an agent did not open. docs/protected-paths.md says that its check does not block dependency updates but agents still do not merge them, and that a dependency file under a protected path is protected (`packages/sandbox/package.json`, #157's finding 2).

#156's findings:

- **N1, the build from the base.** An order check now fails when either part is missing (`at()` in the test), so none passes on -1. The test pins the two checkouts (the event's base and `git checkout --quiet --detach "$base"`), forbids a checkout that names `HEAD_SHA`, `MERGE_SHA`, `refs/ludion/merge`, `head.sha` or `github.sha`, and pins the base branch's refspec and `BASE_REF`. The review's mutations now fail tests. Until this, #156's PR body overstated the tests ("the build from it"); the body is left as reviewed and corrected here.
- **N2, workflow commands in the log.** record.ts prints the record and the judge's text between `::stop-commands::<random token>` and `::<token>::`, as protected-paths.yml does for file names.
- **N3, the failed step.** record.ts loads only node's own modules up front (the judgement type is a type-only import). The judge's renderer is imported after the build. A failed read or `npm ci` is now recorded with that step, not as "the judge did not finish".
- **N4, Node from the base.** setup-node runs after the read step (also after a failed read, for the record script), so `.node-version` comes from the base the judge is built from. "The event's own base SHA is not used" in "The judge on this repository" is narrowed: it is used for the first checkout, which the read step replaces, and in the record until the read step finds the base. When the read step fails before its checkout, that first checkout stays: its `.node-version` and record.ts are then the event base's, which is also a commit of the base branch.
- **N5, a late re-run.** A re-run reuses its event and so its test merge commit. Once the base branch is 50 or more commits past that commit's base, the re-run is undecidable, and the old merge commit may no longer be fetchable. To judge such a PR again, update it (for Dependabot, `@dependabot rebase`), which makes a new event. The code is not changed.
- **N6, the refusal before the artifact.** judge-comment.yml finds the PR from GitHub: the open PRs from the run's head owner and branch into the default branch, of which exactly one must come from the run's head repository and branch and be at the run's head. It then reads what that head changes (`compare/<default branch>...<run head>`), and only when that head is not refused does it list, download and parse the artifact. The record must then name the same PR and head. So a refused head's artifact is never downloaded, and that head gets its fixed notice even when its run left no record. A PR that moved on posts nothing, without reading the artifact. A test runs the script with bash against a stand-in for `gh`.
- **N7, #156's PR body.** "0.918 s now" was measured at 44c0fb6, not at the merged head; that head was checked live instead (0.577 s and 0.701 s). Corrected here.

#158's findings, on CLAUDE.md's line 5:

- **N1.** "`judge()` takes one as an input, but no caller passes it and nothing reads it from the project".
- **N2 and N4.** Rule 2's threshold is "the urgency's base wait (168h in `ludion patch`)", and the Composer note covers both dates and both rules.
- **N3.** What `ludion patch` checks over the lockfile diff includes its acquisition policy's checks on where each package comes from (npm: registry tarballs only, no links; Composer: public zip archives). "Only" is gone.
- **N5.** "the waits of the design's wait table (not its weekly batching)".
- **N6.** The account of #158's second review left out that its N5 (the closing sentence's own paragraph) and N6 (the PR description) were handled, and that its optional "weekly" note and its note on "A stricter project wait wins" were not. The first is now N5 above. The second: "A stricter project wait wins" in "The judge v0 (npm)" is true of `judge()` only; no caller passes one.
- **N7.** The cycle-2 CLAUDE.md entry says "nothing judges them" "stopped being true when rules 1 and 2 began". The candidate's OSV re-scan, which stops on MAL- records too, came with #138, before that phrase was written in #142. So it was not true when written, and is clearly false since rules 1 and 2.
- **N8.** Line 5 is not shortened: the qualifiers are what make it true, as the review says. These edits lengthen it a little.

#157's findings:

- **5.** The two Dependabot entries now follow the judge's entries in decisions.md and progress.md, unchanged.
- **6.** `.github/dependabot.yml`'s comment names judge.yml, which exists since #156 was merged. Nothing to change.

## #166's first review, and what changed after it

The fresh-context review at 39500a4 (https://github.com/Ludion-ai/ludion/pull/166#issuecomment-6468106957) asked for changes:

- **B1.** With "every review ends with `reviewed-sha:`, whatever its verdict" and "the label can stay", a review that asks for changes of the current head turned the required `protected-paths` check green, because protected-paths.yml counted the line in any comment. Fixed with the review's option (a): protected-paths.yml now counts the line only in a comment whose first line has the word `APPROVE` and not `REQUEST` (the jq program `APPROVING`). The first lines of earlier reviews (#151 to #160) have two forms, "Review of #N (…): APPROVE" and "**Independent review** (…): **APPROVE**, with …"; both count, and both forms of "REQUEST CHANGES" do not. docs/protected-paths.md says so in its list, in step 1 and under what the check guarantees. New tests run protected-paths.yml's script with bash against a stand-in for `gh`: both approving forms pass; a request for changes at the current head fails although an older head was approved and the label stayed; an `APPROVE` that is not on the first line does not count.
- **N1.** The PR body named decisions.md for records that are in this README; the PR body is corrected. The decisions.md summary said it "fixes" #158's N8, which is left; it now says so.
- **N2.** The narrowing for #156's N4 now covers a read step that fails before its checkout (above).
- **N3, N5.** Behaviour changes the review called harmless (a refused head gets its notice even after a cancelled run; a PR that is gone ends with exit 0). Kept.
- **N4.** CLAUDE.md and docs/protected-paths.md now also say that agents never enable auto-merge on a dependency-update PR (#157's review, finding 1).

## Checks

### By the session that opened #166, at dd86e86

CLAUDE.md and docs/protected-paths.md now say that every review is recorded on its PR with `reviewed-sha:` and that agents never merge a dependency-update PR, nor any PR an agent did not open. #156's, #158's and #157's remaining findings are fixed (decisions: "Two rules into CLAUDE.md; the follow-ups to #156, #157 and #158's reviews").

Checked in Docker (node:24-slim with jq 1.6 and unzip; `npm ci --ignore-scripts` with network, then `--network none`, read-only root, non-root):

- `npm run typecheck`: exit 0.
- `packages/cli/test/judge-workflow.test.ts`: 27 passed (20 before). The new ones run record.ts with no packages next to it, print a crafted text, and run judge-comment.yml's script with bash against a stand-in for `gh` (posting, updating, a refused head, a PR that moved on, records that do not match).
- `npx vitest run --project node packages`: 8 files, 237 passed.
- Mutations, one at a time: all 19 fail at least one test. They include each of #156's review's uncaught mutations (a checkout of `"$HEAD_SHA"`, `"$MERGE_SHA"` or `refs/ludion/merge` before the build, and a base-branch fetch of `${HEAD_SHA}`), text printed outside the stop markers, judge.ts imported up front, a refused head's artifact read, and the record's PR and head not compared.
- actionlint 1.7.12 on judge.yml and judge-comment.yml: no findings.

The 19 mutations above were run by that session. Its raw output is not in the repository.

### Re-run by the session that took #166 over, at dd86e86

The same head, copied with `git archive` into a Docker volume; `npm ci --ignore-scripts --no-audit --no-fund` with network, in node:24-slim with jq 1.6, unzip and git added (v24.22.1). Then `--network none --read-only`, user `node`. Raw output: `logs/tests-dd86e86.log`, `logs/mutations-dd86e86.log`.

- `npm run typecheck`: exit 0.
- With `--tmpfs /tmp` (Docker's default is `noexec`): judge-workflow.test.ts 4 failed, 23 passed; packages 4 failed, 233 passed. All 4 were the stand-in `gh`, written under `/tmp`, failing with "Permission denied" (exit 126). That is the container, not the code.
- With `--tmpfs /tmp:exec`: judge-workflow.test.ts 27 passed (27); `npx vitest run --project node packages` 8 files, 237 passed (237).
- actionlint 1.7.12, `--network none`, repository mounted read-only, on judge.yml and judge-comment.yml: exit 0, no output.
- 8 mutations, one at a time, with `mutate.sh` (it restores the file after each); each fails at least one test:

  | Mutation | judge-workflow.test.ts |
  | --- | --- |
  | `git checkout --quiet --detach "$HEAD_SHA"` before the build | 1 failed, 26 passed |
  | `git checkout --quiet --detach "$MERGE_SHA"` before the build | 1 failed, 26 passed |
  | `git checkout --quiet --detach refs/ludion/merge` before the build | 1 failed, 26 passed |
  | base-branch fetch of `+${HEAD_SHA}:refs/ludion/base` | 1 failed, 26 passed |
  | record.ts: the `::stop-commands::` line removed | 2 failed, 25 passed |
  | record.ts: judge.ts's renderer imported up front | 2 failed, 25 passed |
  | judge-comment.yml: a refused head's artifact read | 3 failed, 24 passed |
  | judge-comment.yml: the record's PR and head not compared | 3 failed, 24 passed |
  | after restoring | 27 passed |

## Where the summaries were placed

The first version of #166 put this record in the middle of decisions.md and progress.md. The cycle 3 instructions ask for only a few lines at the end of each, with the details under docs/bench/, so it moved here. The two Dependabot entries stay where #166 moved them (#157's finding 5).

### After the B1 fix

The working tree with the B1 fix, copied into a new Docker volume, `npm ci --ignore-scripts` with network, then `--network none --read-only --tmpfs /tmp:exec`, user `node`, with `check-b1.sh`. Raw output: `logs/tests-b1.log`.

- `npm run typecheck`: exit 0.
- judge-workflow.test.ts: 30 passed (30), 3 of them new for protected-paths.yml; `npx vitest run --project node packages`: 8 files, 240 passed (240).
- actionlint 1.7.12 on protected-paths.yml, judge.yml and judge-comment.yml: exit 0, no output.
- Mutations of protected-paths.yml, one at a time, each caught:

  | Mutation | judge-workflow.test.ts |
  | --- | --- |
  | every comment counted again (`--jq ".[].body"`) | 2 failed, 28 passed |
  | `REQUEST` not excluded | 1 failed, 29 passed |
  | `APPROVE` anywhere in the comment, not only on its first line | 1 failed, 29 passed |
  | after restoring | 30 passed |
