# The protected-paths check reads approvals more strictly (LP-core, 2026-10-29)

Fixed before the change is written (night v2, §5, and the advisor's notes of 2026-10-28). The owner merges.

## The rules

The required check `protected-paths` (`.github/workflows/protected-paths.yml`) still needs the `review-approved` label and an approving review of the PR's current head. What counts as that review changes:

1. **Who.** Only comments whose `author_association` is `OWNER`, `MEMBER` or `COLLABORATOR` are read. Anything else (`CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER`, `NONE`, `MANNEQUIN`, a bot's comment such as the judge's, or a missing value) is ignored, whatever it says. Every agent posts from the same account, an `OWNER`, so this keeps outside accounts out; it does not tell agents apart (the check stays a process gate).
2. **Which line is the SHA.** Only the comment's last line is read for `reviewed-sha: <40 lowercase hex>`, after trailing blank lines and spaces and any `\r` are removed. Nothing may follow the SHA on that line except spaces. A `reviewed-sha:` line anywhere else does not count (docs/protected-paths.md already says a review "ends with" it).
3. **What approves.** The first line, with the decoration `*`, `_` and `` ` `` read as spaces and leading spaces, `#` and `>` removed, must begin with the word `APPROVE` and must not contain the word `NOT` or the text `REQUEST`. `APPROVED`, `APPROVE_` and the like are not the word `APPROVE`. Strikethrough (`~`) is not decoration, so `~~APPROVE~~` does not approve. "Review of #7: APPROVE" no longer approves: the verdict must come first.
4. **Case.** `APPROVE`, `NOT` and `REQUEST` match in any case (`approve`, `Not`, `request changes`).
5. **The latest decides.** Of the comments kept by 1 and 2 whose SHA is the current head, the latest decides, as before. A later non-approving review of the same head undoes an approval.
6. **Fails closed.** A comment with no body counts as no review. Any failure of `gh` stops the check red.
7. **Paths.** `action/` and the root `action.yml` become protected paths. The task names `action/`; `action.yml` is added by this lane's own reading, because it is the action's entry point and decides what `action/` runs in users' workflows. Protecting the directory without its entry point would leave the same code reachable through an unprotected file.

## Tests

The tests run the workflow's script with bash against a stand-in for `gh` (as #166's did), moved to their own file, `packages/cli/test/protected-paths-workflow.test.ts`. They cover: no review of the head, no label, each `gh` call failing, "do NOT APPROVE", "APPROVE, but NOT yet", an outside user's APPROVE, an empty and a missing body, a `reviewed-sha:` line that is not the last, lower-case verdicts, decoration, and the latest review deciding. Mutations of the rules, one at a time, must each fail at least one test; the record is in docs/bench/2026-10-29-lp-core/.

## Not changed

The label, who may add it, the gate's other conditions and the wait table. Comments can be edited after they are posted, and the check reads each comment as it is when the check runs; that is unchanged.
