# 2026-10-30 (LA5) — #203's judge runs once per fix in #204's per-fix patch

Main b210435 (#203 LC, #207 LE2) merged into PR #204's branch. As the review of #203 at f976ec2 (comment 6501442567, its last section) asked, `ludion patch` and `watch` now judge each npm fix on its own. The call sits inside the fix's `try`, after that fix's time cap and before `client.scan`, the tests and `fixBranch`. It judges `candidate.exported` against the project's own package.json and package-lock.json. A refusal fails only that fix: it gets no branch, and the run ends `failed` or `partial` (exit 2). `judgement` moved from `DependencyReceipt` to `FixReceipt`. What changed and how it was checked: docs/bench/2026-10-29-la-per-fix-apply/README.md, "Merging #203".

- **Tests** (Docker, image ludion-l9-node24-git):
  - `tsc -p tsconfig.json` exits 0. The CLI tests: 18 files, 743 passed, 19 skipped (`logs/test.log`).
  - CI's checks except Playwright, against a stand-in repository: typecheck 0, build 0, and `npm test` with 30 files, 978 passed, 19 skipped (`logs/full.log`).
  - 39 of 39 mutations caught, five of them new for the per-fix judge (`logs/mutate.log`).
- **The built CLI on the examples** (`logs/e2e.log`, started 2026-10-29T16:28:08Z), `patch --apply` twice on committed copies of examples/*-security, with the real sandbox:

| Case | Fix | First run | Judge | judgement.exposure.fix_published_at | fix_published_at | applied_at |
|---|---|---|---|---|---|---|
| npm | lodash 4.17.20 → 4.18.0 | failed: "The judge stops the candidate: gate 2: lodash@4.18.0 is deprecated: Bad release. Please use lodash@4.17.21 instead." | stop | 2026-03-31T18:18:42.717Z | 2026-03-31T18:18:42.717Z | null |
| npm, two fixes | lodash 4.17.20 → 4.18.0 | failed (the same judge stop) | stop | 2026-03-31T18:18:42.717Z | 2026-03-31T18:18:42.717Z | null |
| | minimist 1.2.5 → 1.2.6 | applied, ludion/npm/minimist-1.2.6 | ready_except_build (high, 24h) | 2022-03-22T02:50:30.352Z | 2022-03-22T02:50:30.352Z | 2026-10-29T16:28:53.500Z |
| PHP | the Dockerfile's PHP image → 8.4.27 | applied, ludion/php/8.4.27 | not judged | — | 2026-10-21T00:00:00.000Z | 2026-10-29T16:29:09.071Z |
| Composer | symfony/http-foundation 5.4.0 → 5.4.54 | applied | not judged | — | 2026-09-30T11:07:08.000Z | 2026-10-29T16:29:22.561Z |
| Maven | commons-text 1.9 → 1.10.0 | failed (commons-lang3 3.12.0 still under GHSA-j288-q9x7-2f5v) | not judged | — | null | null |
| | commons-lang3 3.11 → 3.18.0 | applied | not judged | — | null | 2026-10-29T16:29:39.751Z |

- **Outcomes.** failed, partial, applied, applied and partial on the first run; on the second, every fix with a branch was skipped and the refused or failed fixes failed again.
- **What changed from the 2026-10-29 run.** The npm example's only fix is now refused by the judge, because the plan picks lodash 4.18.0, which the registry marks deprecated. Before #203 it was committed. Choosing a different fixed version is not built.
- **Each judgement sees only its own fix.** In the two-fix npm run, lodash's judgement lists only lodash's change and minimist's only minimist's, and minimist's `detected_at` (16:28:50.400Z) lies between the run's `found_at` (16:28:41.671Z) and its `applied_at` (16:28:53.500Z).
- **Not done.** Nothing was released or merged, and nothing was pushed from the example repositories.
