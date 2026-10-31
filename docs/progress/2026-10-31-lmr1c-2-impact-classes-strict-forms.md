# 2026-10-31 (LMR1c-2) — Impact Classes: the protection record shows only values of a strict form, and escapes \ before |

Continues PR #236 from its head 924d915, for ludion-ops#1 comment 6539423358 (CodeQL's "incomplete string escaping" alert on impact.ts's code span). The alert is fixed, not dismissed, and the record stays a Markdown table. No gate, wait, judgement or class changes, and nothing Ludion outputs changes yet (the record is not wired in).

- **Strict forms, the main defence** (packages/cli/src/security/impact.ts). The rows come from receipts, which are not trusted. Each row now names its ecosystem, as deliver.ts names them (npm, composer, maven, php). A row is shown only when:
  - its package has that ecosystem's name form: npm's optional scope and name; Composer's vendor/name, written without optional separators so it cannot backtrack; Maven's groupId:artifactId; or `php`. The name has at most 214 characters.
  - its versions have deliver.ts's version form.
  - its class and severity are in their lists.
  - a trap's record id has an id's form (deliver.ts's advisory form).

  None of these forms allows `\`, `|`, a backtick or a line break, so an honest receipt loses no row. Any other row is counted, not dropped in silence. A line says "Rows that could not be read: N. Their contents are not shown." (「読めない行が N 件あった。中身は出していない。」), and none of its values enters the table or the summary. The other refusals (action, stop reason, trap record, times) still throw, as before.
- **Escaping, the second defence.** `codeSpan()` removes line breaks (CR, LF, U+2028, U+2029), doubles every `\`, then escapes every `|`. It is exported for its tests.
- **What GitHub shows.** GitHub's Markdown API (mode gfm, made-up strings only, 2026-10-31) rendered these, each in a table cell:
  - `a\\\|b` in one cell, as `a\\|b`;
  - `a\\b` as `a\\b`;
  - the old form `a\\|b` in one cell, as `a\|b`.

  So the full escaping keeps the row whole, but shows each backslash twice; no shown value holds one, because of the strict forms.
- **Tests** (packages/cli/test/impact.test.ts, 44):
  - honest names and versions of all four ecosystems are shown;
  - 42 malformed rows are counted and none of their values appears. Among them are `a\|b`, a trailing `\`, `\\|`, line breaks, backticks, other ecosystems' forms, a 215-character name, a class or severity outside its list, and a trap id with `|` or `\`;
  - the table keeps its columns;
  - `codeSpan` gives the exact escaped text for 12 inputs, and both readings of a row (micromark's and GitHub's) split it into the same 3 cells.
- **Mutations** (docs/bench/2026-10-31-lmr1-impact-classes/scripts/mutate.mjs): **64 of 64** caught (`logs/mutate.log`, 06:16:57Z). There are 14 new ones: `\` not escaped; `\` escaped after `|`; the form not checked; unreadable rows not counted; the note left out; npm's form for every ecosystem; an ecosystem that is not a string; the name limit dropped; from or to not checked; the class or severity list not checked; Composer capitals; a trap's id not checked. "The record's id not escaped" was dropped: an id must now have an id's form, so that mutation changes no output.
- **Checks** (Docker only, `--network none`, `--memory=4g`):
  - test.sh (06:16:24Z): tsc 0; CLI tests 979 passed, 24 skipped.
  - full.sh (06:18:33Z, tree 6080eb1): typecheck 0, build 0, `npm test -- --maxWorkers=2` 1266 passed, 24 skipped.

## branch.test.ts: one failure, counted

The test "a fix on its own branch > refuses a symbolic link inside .git where Git would write, and a reflog the branch already has" failed once. It was the LMR1b full.sh run at 2026-10-31T04:34:26Z on tree 0e05cf7. That run's log, as it was kept (full.sh keeps only summary lines, so the error itself is not known):

```
# started 2026-10-31T04:34:26Z, node v24.22.1, git version 2.39.5
stand-in repository: 1220 files
== npm run typecheck
typecheck exit 0
== npm run build
build exit 0
== npm test -- --maxWorkers=2
npm test exit 1
 FAIL  |node| packages/cli/test/branch.test.ts > a fix on its own branch > refuses a symbolic link inside .git where Git would write, and a reflog the branch already has
 Test Files  1 failed | 38 passed (39)
      Tests  1 failed | 1254 passed | 24 skipped (1279)
# finished 2026-10-31T04:34:47Z
```

Runs of branch.test.ts known to this PR's lanes, each counted from its log or its CI run (runs in LMR1 before 0e62900 are not known):

| Where | Runs | Failed |
|---|---|---|
| LMR1b, full.sh (04:31, 04:34, 04:35Z) | 3 | 1 |
| LMR1b, the file alone right after the failure | 3 | 0 |
| LMR1b, test.sh (04:29Z) | 1 | 0 |
| LMR1c and LMR1c-2, test.sh (05:18, 05:19, 05:22, 05:28, 06:16Z, and two whose start times were not kept, one between 05:19 and 05:22, one before 06:13) | 7 | 0 |
| LMR1c and LMR1c-2, full.sh (05:29, 05:31, 06:18Z) | 3 | 0 |
| CI `test` on 0e62900, e900122, 218a83a, 0345636, 924d915 | 5 | 0 |
| **Total** | **22** | **1** |

If it fails again, a lane looks for the cause (the time, the order the tests run in, temporary files), as the chat said; until then, count the runs and the failures.
