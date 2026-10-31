# 2026-10-31 (LMR1c-3) — Impact Classes: a code span refuses \, | and line breaks instead of escaping them

Continues PR #236 from its head d2e25a0, for ludion-ops#1 comment 6539943852 (b). It replaces point 2 of comment 6539423358 (escape `\` as `\\`), which LMR1c-2 had done. No gate, wait, judgement or class changes, and nothing Ludion outputs changes yet (the record is not wired in).

- **Why.** A code span shows an escaping backslash as written. GitHub's Markdown API rendered `a\\\|b` in a table cell as `a\\|b` (docs/progress/2026-10-31-lmr1c-2-impact-classes-strict-forms.md).
- **Code** (packages/cli/src/security/impact.ts). `codeSpan()` escapes nothing. It throws on text that holds `\`, `|`, CR, LF, U+2028 or U+2029. It still lengthens the fence past any backtick run and pads a span that starts or ends with a space or backtick. The two defences are now:
  - the strict forms of LMR1c-2: a row whose values do not have their form is not shown, only counted;
  - this refusal.

  So no row reaches the throw, and no text is replaced.
- **Tests** (packages/cli/test/impact.test.ts, 44).
  - `codeSpan` refuses 12 texts with `\`, `|` or a line break, among them `a\|b`, a trailing `\` and `\\|`, with the exact message.
  - It gives the exact span for 10 others (names, backticks, padding, the empty text).
  - Both readings of a row (micromark's, GitHub's) keep 3 cells.
  - The strict-form tests of LMR1c-2 are unchanged and pass.
- **Mutations**: **67 of 67** caught (docs/bench/2026-10-31-lmr1-impact-classes/logs/mutate.log, 06:41:47Z).
  - Removed: LMR1's "| not escaped" and "line breaks kept", and LMR1c-2's "\ not escaped" and "\ escaped after |".
  - Added: one mutation for each refused character (`\`, `|`, CR, LF, U+2028, U+2029), and one that escapes `|` instead of refusing it.
- **Checks** (Docker only, `--network none`, `--memory=4g`):
  - test.sh (06:41:13Z): tsc 0; CLI tests 979 passed, 24 skipped.
  - full.sh (06:43:07Z, tree d0983a1): typecheck 0, build 0, `npm test -- --maxWorkers=2` 1266 passed, 24 skipped.
- **branch.test.ts**: since LMR1c-2's count of 22 runs and 1 failure, it ran 3 more times and passed each time: CI on d2e25a0, test.sh at 06:41Z and full.sh at 06:43Z. That makes **25 runs, 1 failure**.
