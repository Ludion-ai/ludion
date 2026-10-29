# 2026-10-29 (LA) — Each fix is validated and applied on its own branch; receipts carry the exposure-time timestamps

docs/status.md, "Missing before complete", item 2, in part. `ludion patch --apply` validates each fix alone against one baseline. It commits each fix that passes on its own branch, and a failing fix stops no other. Receipts carry `fix_published_at`, `found_at` and `applied_at`. Nothing opens the PR yet. What changed and how it was checked: docs/bench/2026-10-29-la-per-fix-apply/README.md.

- **Tests** (Docker, image ludion-l9-node24-git):
  - `tsc -p tsconfig.json` exits 0.
  - The CLI tests: 16 files, 689 passed, 19 skipped (`logs/test.log`).
  - CI's checks except Playwright, against a stand-in repository: typecheck 0, build 0, and `npm test` with 28 files, 924 passed, 19 skipped (`logs/full.log`).
  - 31 of 31 mutations caught (`logs/mutate.log`).
- **The built CLI on the examples.** `patch --apply` ran twice on copies of examples/*-security, each committed in a repository of its own, with the real sandbox through the host's Docker (`logs/e2e.log`, started 2026-10-29T13:08:29Z). In every case the working tree was unchanged afterwards, and each branch is one commit whose parent is the copy's commit.

| Case | Fix | First run | Branch | fix_published_at | found_at | applied_at |
|---|---|---|---|---|---|---|
| npm | lodash 4.17.20 → 4.18.0 | applied | ludion/npm/lodash-4.18.0 | 2026-03-31T18:18:42.717Z | 2026-10-29T13:08:37.480Z | 2026-10-29T13:08:44.973Z |
| npm, two fixes (the app's test requires lodash 4.17.20) | lodash 4.17.20 → 4.18.0 | failed: "Application validation failed (1)" | none | 2026-03-31T18:18:42.717Z | 2026-10-29T13:08:48.278Z | null |
| | minimist 1.2.5 → 1.2.6 | applied | ludion/npm/minimist-1.2.6 | 2022-03-22T02:50:30.352Z | 2026-10-29T13:08:48.278Z | 2026-10-29T13:08:56.756Z |
| PHP | php:8.4.26-cli-alpine → 8.4.27 | applied | ludion/php/8.4.27 | 2026-10-21T00:00:00.000Z (php.net gives the day only) | 2026-10-29T13:09:04.069Z | 2026-10-29T13:09:09.360Z |
| Composer | symfony/http-foundation 5.4.0 → 5.4.54 | applied | ludion/composer/symfony-http-foundation-5.4.54 | 2026-09-30T11:07:08.000Z (Packagist, set by the author) | 2026-10-29T13:09:11.053Z | 2026-10-29T13:09:24.206Z |
| Maven | commons-text 1.9 → 1.10.0 | applied | ludion/maven/org.apache.commons-commons-text-1.10.0 | null (not read for Maven) | 2026-10-29T13:09:29.566Z | 2026-10-29T13:09:39.101Z |
| | commons-lang3 3.11 → 3.18.0 | applied | ludion/maven/org.apache.commons-commons-lang3-3.18.0 | null (not read for Maven) | 2026-10-29T13:09:29.566Z | 2026-10-29T13:09:43.640Z |

- **Outcomes.** The run outcomes were applied, partial (exit 2), applied, applied and applied.
- **The second run.** Every fix with a branch was skipped, and no Docker work ran for it; four of the five runs ended `skipped` (exit 0). In the two-fix npm case, lodash was validated again and failed again (`failed`, exit 2).
- **A change after the cloud review.** A candidate's finding on a package version the baseline did not have now stops the fix in npm and Composer, and a MAL- record on an installed package stops the run (docs/mistakes/2026-10-29-a-fix-carried-a-mal-record.md). Only Maven still carries another package within an advisory the baseline had, as commons-text does below.
- **A change made after the first Maven run.** With findings compared by version, commons-text's fix failed. Alone, it brings commons-lang3 3.12.0, which has the same advisory the baseline's 3.11 had (GHSA-j288-q9x7-2f5v), and commons-lang3's own fix removes that advisory. The check now compares by package and advisory. A test and two mutations cover it. That first run's log was not kept.
- **A finding left beside a fix.** The commons-text branch alone leaves commons-lang3 at 3.12.0, still under GHSA-j288-q9x7-2f5v; its receipt lists that in `carried_findings`. The commons-lang3 branch fixes it.
- **Exposure time is not measured here.** These are copies of examples pinned to old versions, so the gap between `fix_published_at` and `applied_at` says nothing about Ludion's speed. `found_at` is the run's own lookup, not the first run that saw the fix.
- **Not built.** Opening the PR, a project apply setting, a `found_at` that remembers earlier runs, and Maven's publish time.
- **Not done.** Nothing was released, and nothing was pushed from the example repositories.
